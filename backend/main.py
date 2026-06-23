"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import uuid
import json
import asyncio

from . import storage
from .auth import get_current_user
from .council import run_full_council, generate_conversation_title, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings
from .openrouter import query_model

app = FastAPI(title="LLM Council API")

# Enable CORS for development and VM IP access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    api_keys: Optional[Dict[str, str]] = None
    azure_settings: Optional[Dict[str, Any]] = None
    council_models: Optional[List[str]] = None
    chairman_model: Optional[str] = None


class LoginRequest(BaseModel):
    """Request to log in and get token."""
    email: str
    password: str


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


class FollowUpRequest(BaseModel):
    """Request to send a follow-up message to a specific model."""
    content: str
    model: str
    message_index: int
    api_keys: Optional[Dict[str, str]] = None
    azure_settings: Optional[Dict[str, Any]] = None


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.post("/api/login")
async def login(request: LoginRequest):
    """Log in endpoint."""
    from .auth import verify_password, create_token, ALLOWED_EMAILS
    if request.email not in ALLOWED_EMAILS:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not verify_password(request.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
        
    token = create_token(request.email)
    return {"token": token, "email": request.email}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations(current_user: str = Depends(get_current_user)):
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest, current_user: str = Depends(get_current_user)):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str, current_user: str = Depends(get_current_user)):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@app.get("/api/conversations/{conversation_id}/download")
async def download_conversation(conversation_id: str, current_user: str = Depends(get_current_user)):
    """Download a conversation as Markdown."""
    from fastapi.responses import PlainTextResponse

    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    title = conversation.get("title", "Conversation")
    lines = [f"# {title}", ""]

    messages = conversation.get("messages", [])
    for idx, msg in enumerate(messages):
        if msg.get("followup_group") is not None:
            continue

        if msg["role"] == "user":
            lines.append("## User")
            lines.append("")
            lines.append(msg["content"])
            lines.append("")
        else:
            lines.append("## LLM Council")
            lines.append("")

            stage1 = msg.get("stage1") or []
            if stage1:
                lines.append("### Stage 1: Individual Responses")
                lines.append("")
                for r in stage1:
                    model = r.get("model", "Unknown")
                    response_text = r.get("response", "")
                    lines.append(f"#### {model}")
                    lines.append("")
                    lines.append(response_text)
                    lines.append("")

            stage2 = msg.get("stage2") or []
            if stage2:
                lines.append("### Stage 2: Peer Rankings")
                lines.append("")
                for r in stage2:
                    model = r.get("model", "Unknown")
                    ranking = r.get("ranking", "")
                    lines.append(f"#### {model}")
                    lines.append("")
                    lines.append(ranking)
                    lines.append("")

            stage3 = msg.get("stage3") or {}
            response_text = stage3.get("response", "")
            if response_text:
                lines.append("### Stage 3: Final Synthesis")
                lines.append("")
                lines.append(response_text)
                lines.append("")

            followups = [m for m in messages if m.get("followup_group") == idx]
            if followups:
                lines.append("### Follow-up Discussion")
                lines.append("")
                for f in followups:
                    label = f"User (to {f.get('model', 'council')})" if f["role"] == "user" else f"Assistant ({f.get('model', 'council')})"
                    lines.append(f"**{label}:**")
                    lines.append("")
                    lines.append(f["content"])
                    lines.append("")

    markdown_content = "\n".join(lines)

    filename = f"{title.lower().replace(' ', '-')[:50]}.md"
    return PlainTextResponse(
        content=markdown_content,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.post("/api/conversations/{conversation_id}/message")
async def send_message(conversation_id: str, request: SendMessageRequest, current_user: str = Depends(get_current_user)):
    """
    Send a message and run the 3-stage council process.
    Returns the complete response with all stages.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    # Add user message
    storage.add_user_message(conversation_id, request.content)

    # If this is the first message, generate a title
    if is_first_message:
        title = await generate_conversation_title(
            request.content,
            chairman_model=request.chairman_model,
            api_keys=request.api_keys,
            azure_settings=request.azure_settings
        )
        storage.update_conversation_title(conversation_id, title)

    # Run the 3-stage council process
    stage1_results, stage2_results, stage3_result, metadata = await run_full_council(
        request.content,
        models=request.council_models,
        chairman_model=request.chairman_model,
        api_keys=request.api_keys,
        azure_settings=request.azure_settings
    )

    # Add assistant message with all stages
    storage.add_assistant_message(
        conversation_id,
        stage1_results,
        stage2_results,
        stage3_result
    )

    # Return the complete response with metadata
    return {
        "stage1": stage1_results,
        "stage2": stage2_results,
        "stage3": stage3_result,
        "metadata": metadata
    }


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, request: SendMessageRequest, current_user: str = Depends(get_current_user)):
    """
    Send a message and stream the 3-stage council process.
    Returns Server-Sent Events as each stage completes.
    """
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        try:
            # Add user message
            storage.add_user_message(conversation_id, request.content)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(
                    generate_conversation_title(
                        request.content,
                        chairman_model=request.chairman_model,
                        api_keys=request.api_keys,
                        azure_settings=request.azure_settings
                    )
                )

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            stage1_results = await stage1_collect_responses(
                request.content,
                models=request.council_models,
                api_keys=request.api_keys,
                azure_settings=request.azure_settings
            )
            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"

            # Stage 2: Collect rankings
            yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
            stage2_results, label_to_model = await stage2_collect_rankings(
                request.content, 
                stage1_results,
                models=request.council_models,
                api_keys=request.api_keys,
                azure_settings=request.azure_settings
            )
            aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
            yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings}})}\n\n"

            # Stage 3: Synthesize final answer
            yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
            stage3_result = await stage3_synthesize_final(
                request.content, 
                stage1_results, 
                stage2_results,
                chairman_model=request.chairman_model,
                api_keys=request.api_keys,
                azure_settings=request.azure_settings
            )
            yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                title = await title_task
                storage.update_conversation_title(conversation_id, title)
                yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"

            # Save complete assistant message
            storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results,
                stage3_result
            )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except Exception as e:
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.post("/api/conversations/{conversation_id}/followup")
async def send_followup(conversation_id: str, request: FollowUpRequest, current_user: str = Depends(get_current_user)):
    """
    Send a follow-up message to a specific model with full council context.
    Used after Stage 3 completes for continued discussion.
    """
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    messages_list = conversation["messages"]
    if request.message_index < 0 or request.message_index >= len(messages_list):
        raise HTTPException(status_code=400, detail="Invalid message index")

    council_msg = messages_list[request.message_index]
    if council_msg["role"] != "assistant" or "stage1" not in council_msg:
        raise HTTPException(status_code=400, detail="Message is not a council response")

    # Build context messages for the selected model
    context_messages = _build_followup_context(council_msg, conversation, request.message_index, request.content, request.model)

    # Store user follow-up message
    storage.add_followup_message(
        conversation_id, request.message_index, "user", request.content, model=request.model
    )

    # Query the selected model
    response = await query_model(
        request.model, context_messages,
        api_keys=request.api_keys, azure_settings=request.azure_settings
    )

    response_content = response.get('content', '') if response else "Model failed to respond."
    response_model = request.model

    # Store assistant follow-up response
    storage.add_followup_message(
        conversation_id, request.message_index, "assistant", response_content
    )

    return {
        "role": "assistant",
        "content": response_content,
        "model": response_model
    }


def _build_followup_context(
    council_msg: dict,
    conversation: dict,
    council_index: int,
    new_message: str,
    selected_model: str
) -> List[Dict[str, str]]:
    """Build message list for follow-up query with full council context."""

    # Find the original user question that triggered this council response
    original_question = ""
    for i in range(council_index - 1, -1, -1):
        m = conversation["messages"][i]
        if m["role"] == "user" and "followup_group" not in m:
            original_question = m["content"]
            break

    # Format Stage 1 responses
    stage1_text = "\n\n".join([
        f"{r['model']}:\n{r['response']}"
        for r in (council_msg.get("stage1") or [])
    ]) or "(No responses)"

    # Format Stage 2 rankings
    stage2_text = "\n\n".join([
        f"{r['model']}:\n{r['ranking']}"
        for r in (council_msg.get("stage2") or [])
    ]) or "(No rankings)"

    stage3 = council_msg.get("stage3") or {}
    stage3_text = stage3.get("response", "(No synthesis)")

    # Collect previous follow-ups in this group
    prev_followups = []
    for i in range(council_index + 1, len(conversation["messages"])):
        m = conversation["messages"][i]
        if m.get("followup_group") == council_index:
            prev_followups.append(m)

    prev_chat_text = ""
    if prev_followups:
        parts = []
        for m in prev_followups:
            sender = f"User (to {m.get('model', selected_model)})" if m["role"] == "user" else f"Assistant ({m.get('model', selected_model)})"
            parts.append(f"{sender}: {m['content']}")
        prev_chat_text = "\n\n".join(parts)

    system_prompt = f"""You are {selected_model}, a member of the LLM Council. The council has just completed a deliberation on a question. You are now in a follow-up discussion with the user, who has chosen to speak directly with you.

=== COUNCIL DELIBERATION CONTEXT ===

Original Question: {original_question}

Stage 1 - Individual Responses from all council members:
{stage1_text}

Stage 2 - Peer Rankings:
{stage2_text}

Stage 3 - Final Synthesis by Chairman ({stage3.get("model", "unknown")}):
{stage3_text}

=== FOLLOW-UP DISCUSSION ===

Respond helpfully, using the council's deliberation as context for your answers. Reference specific points from the deliberation when relevant."""

    # Build messages array
    context_messages = [{"role": "system", "content": system_prompt}]

    for m in prev_followups:
        if m["role"] == "user":
            context_messages.append({"role": "user", "content": m["content"]})
        else:
            context_messages.append({"role": "assistant", "content": m["content"]})

    context_messages.append({"role": "user", "content": new_message})

    return context_messages


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)

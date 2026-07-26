"""Prompt template management API routes."""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.database import get_db
from app.models.prompt_template import PromptTemplate
from app.models.user import User
from app.schemas.prompts import (
    PromptTemplateOut,
    PromptTemplateListResponse,
    PromptTemplateUpdateRequest,
)
from app.services.prompt_defaults import DEFAULT_PROMPTS, PLACEHOLDERS, TEMPLATE_NAMES

router = APIRouter()

# All valid template names
_VALID_NAMES = frozenset(DEFAULT_PROMPTS.keys())


def _build_response(name: str, row: PromptTemplate | None) -> PromptTemplateOut:
    """Build a PromptTemplateOut from defaults + optional DB override."""
    defaults = DEFAULT_PROMPTS[name]
    placeholders = PLACEHOLDERS.get(name, [])

    if row is not None and (row.system_prompt or row.user_prompt):
        return PromptTemplateOut(
            name=name,
            display_name=TEMPLATE_NAMES.get(name, name),
            system_prompt=row.system_prompt,
            user_prompt=row.user_prompt,
            placeholders=list(placeholders),
            is_customized=True,
            updated_at=row.updated_at,
        )

    return PromptTemplateOut(
        name=name,
        display_name=TEMPLATE_NAMES.get(name, name),
        system_prompt=defaults["system_prompt"],
        user_prompt=defaults["user_prompt"],
        placeholders=list(placeholders),
        is_customized=False,
        updated_at=None,
    )


@router.get("", response_model=PromptTemplateListResponse)
async def list_prompt_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all prompt templates with current values.

    Returns all three template types (translate, analyze_words, analyze_sentences).
    For each, returns the custom version if one exists in the DB, otherwise the
    built-in default.  The ``is_customized`` flag indicates which case applies.
    """
    stmt = select(PromptTemplate)
    result = await db.execute(stmt)
    rows: dict[str, PromptTemplate] = {r.name: r for r in result.scalars().all()}

    templates = [_build_response(name, rows.get(name)) for name in sorted(_VALID_NAMES)]
    return PromptTemplateListResponse(templates=templates)


@router.get("/{name}", response_model=PromptTemplateOut)
async def get_prompt_template(
    name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single prompt template by name."""
    if name not in _VALID_NAMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown template name: {name}. Valid: {', '.join(sorted(_VALID_NAMES))}",
        )

    stmt = select(PromptTemplate).where(PromptTemplate.name == name)
    result = await db.execute(stmt)
    row = result.scalars().first()

    return _build_response(name, row)


@router.put("/{name}", response_model=PromptTemplateOut)
async def update_prompt_template(
    name: str,
    request: PromptTemplateUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or update a prompt template.

    Upserts the row for the given template name.  Subsequent AI calls will use
    the custom prompt instead of the built-in default.
    """
    if name not in _VALID_NAMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown template name: {name}. Valid: {', '.join(sorted(_VALID_NAMES))}",
        )

    stmt = select(PromptTemplate).where(PromptTemplate.name == name)
    result = await db.execute(stmt)
    row = result.scalars().first()

    if row is None:
        row = PromptTemplate(name=name)
        db.add(row)

    row.system_prompt = request.system_prompt
    row.user_prompt = request.user_prompt
    await db.commit()
    await db.refresh(row)

    return _build_response(name, row)


@router.post("/{name}/reset", response_model=PromptTemplateOut)
async def reset_prompt_template(
    name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reset a single prompt template to its built-in default.

    Deletes the custom row from the database.  The next GET request (and all
    subsequent AI calls) will use the default prompt from prompt_defaults.py.
    """
    if name not in _VALID_NAMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown template name: {name}. Valid: {', '.join(sorted(_VALID_NAMES))}",
        )

    stmt = delete(PromptTemplate).where(PromptTemplate.name == name)
    await db.execute(stmt)
    await db.commit()

    return _build_response(name, None)


@router.post("/reset-all", response_model=PromptTemplateListResponse)
async def reset_all_prompt_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reset all prompt templates to built-in defaults.

    Deletes every custom prompt row.  All AI calls will use the original
    default prompts from prompt_defaults.py.
    """
    stmt = delete(PromptTemplate)
    await db.execute(stmt)
    await db.commit()

    templates = [_build_response(name, None) for name in DEFAULT_PROMPTS]
    return PromptTemplateListResponse(templates=templates)

"""Prompt template management API routes.

Two-tier prompt system:
- is_default=True  → admin-defined system default (set via /default or set_as_default)
- is_default=False → user-level custom override (currently unused, legacy rows)
- Factory default  → hardcoded in prompt_defaults.py (fallback when no DB row)
"""

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy import select, delete, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require_superuser
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


def _build_out(
    name: str,
    *,
    system_prompt: str,
    user_prompt: str,
    is_customized: bool = False,
    is_default: bool = False,
    updated_at=None,
) -> PromptTemplateOut:
    """Build a PromptTemplateOut with explicit values."""
    placeholders = PLACEHOLDERS.get(name, [])
    return PromptTemplateOut(
        name=name,
        display_name=TEMPLATE_NAMES.get(name, name),
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        placeholders=list(placeholders),
        is_customized=is_customized,
        is_default=is_default,
        updated_at=updated_at,
    )


def _factory(name: str) -> PromptTemplateOut:
    """Return the factory (hardcoded) default for a template."""
    defaults = DEFAULT_PROMPTS[name]
    return _build_out(
        name,
        system_prompt=defaults["system_prompt"],
        user_prompt=defaults["user_prompt"],
    )


def _best_row(rows: list[PromptTemplate]) -> PromptTemplate | None:
    """Pick the most specific row: custom (is_default=False) before default (True)."""
    customs = [r for r in rows if not r.is_default]
    defaults = [r for r in rows if r.is_default]
    for r in customs + defaults:
        if r.system_prompt or r.user_prompt:
            return r
    return None


@router.get("", response_model=PromptTemplateListResponse)
async def list_prompt_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all prompt templates with current effective values.

    Returns the effective prompt for each type along with metadata about
    which tier is active (custom / admin-default / factory-default).
    """
    stmt = select(PromptTemplate).order_by(PromptTemplate.name, PromptTemplate.is_default)
    result = await db.execute(stmt)
    all_rows = result.scalars().all()

    # Group by name
    by_name: dict[str, list[PromptTemplate]] = {}
    for r in all_rows:
        by_name.setdefault(r.name, []).append(r)

    templates: list[PromptTemplateOut] = []
    for name in sorted(_VALID_NAMES):
        rows = by_name.get(name, [])
        best = _best_row(rows)
        if best and (best.system_prompt or best.user_prompt):
            templates.append(_build_out(
                name,
                system_prompt=best.system_prompt,
                user_prompt=best.user_prompt,
                is_customized=not best.is_default,
                is_default=best.is_default,
                updated_at=best.updated_at,
            ))
        else:
            templates.append(_factory(name))

    return PromptTemplateListResponse(templates=templates)


@router.get("/{name}", response_model=PromptTemplateOut)
async def get_prompt_template(
    name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single prompt template by name (effective version)."""
    if name not in _VALID_NAMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown template name: {name}. Valid: {', '.join(sorted(_VALID_NAMES))}",
        )

    stmt = select(PromptTemplate).where(PromptTemplate.name == name)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    best = _best_row(rows)

    if best and (best.system_prompt or best.user_prompt):
        return _build_out(
            name,
            system_prompt=best.system_prompt,
            user_prompt=best.user_prompt,
            is_customized=not best.is_default,
            is_default=best.is_default,
            updated_at=best.updated_at,
        )
    return _factory(name)


@router.put("/{name}", response_model=PromptTemplateOut)
async def update_prompt_template(
    name: str,
    request: PromptTemplateUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """Save a prompt override (is_default=False custom or system default).

    Set ``set_as_default=True`` to save as the admin-defined system default
    instead (is_default=True). Prompt templates are global configuration,
    so every write requires admin privileges (the admin UI is the only editor).
    """
    if name not in _VALID_NAMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown template name: {name}. Valid: {', '.join(sorted(_VALID_NAMES))}",
        )

    # Prompt templates are global configuration — every write is admin-only.
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403,
            detail="Admin access required to edit prompt templates.",
        )

    is_default = request.set_as_default

    # Defense in depth: system defaults affect every user's AI requests.
    if is_default and not current_user.is_superuser:
        raise HTTPException(
            status_code=403,
            detail="Admin access required to set system default prompts.",
        )

    # Upsert the row for (name, is_default)
    stmt = select(PromptTemplate).where(
        and_(PromptTemplate.name == name, PromptTemplate.is_default == is_default)
    )
    result = await db.execute(stmt)
    row = result.scalars().first()

    if row is None:
        row = PromptTemplate(name=name, is_default=is_default)
        db.add(row)

    row.system_prompt = request.system_prompt
    row.user_prompt = request.user_prompt
    await db.commit()
    await db.refresh(row)

    return _build_out(
        name,
        system_prompt=row.system_prompt,
        user_prompt=row.user_prompt,
        is_customized=not is_default,
        is_default=is_default,
        updated_at=row.updated_at,
    )


@router.put("/{name}/default", response_model=PromptTemplateOut)
async def set_default_prompt(
    name: str,
    request: PromptTemplateUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """Set (or update) the admin-defined system default for a template.

    This is a convenience endpoint — equivalent to PUT /{name} with
    ``set_as_default=true``.
    """
    request.set_as_default = True
    return await update_prompt_template(name, request, db, current_user)


@router.post("/{name}/promote", response_model=PromptTemplateOut)
async def promote_to_default(
    name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """Promote the current custom prompt (is_default=False) to system default (is_default=True).

    Copies the custom prompt's content to the default tier, then deletes the
    custom tier row.  After promotion, all users see this prompt as the
    effective default.
    """
    if name not in _VALID_NAMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown template name: {name}. Valid: {', '.join(sorted(_VALID_NAMES))}",
        )

    # Find the custom row
    stmt = select(PromptTemplate).where(
        and_(PromptTemplate.name == name, ~PromptTemplate.is_default)
    )
    result = await db.execute(stmt)
    custom = result.scalars().first()

    if custom is None or (not custom.system_prompt and not custom.user_prompt):
        raise HTTPException(
            status_code=400,
            detail="No custom prompt exists to promote. Save a custom prompt first.",
        )

    # Upsert the default row with custom's content
    stmt2 = select(PromptTemplate).where(
        and_(PromptTemplate.name == name, PromptTemplate.is_default)
    )
    result2 = await db.execute(stmt2)
    default_row = result2.scalars().first()

    if default_row is None:
        default_row = PromptTemplate(name=name, is_default=True)
        db.add(default_row)

    default_row.system_prompt = custom.system_prompt
    default_row.user_prompt = custom.user_prompt

    # Delete the custom row
    await db.delete(custom)
    await db.commit()
    await db.refresh(default_row)

    return _build_out(
        name,
        system_prompt=default_row.system_prompt,
        user_prompt=default_row.user_prompt,
        is_customized=False,
        is_default=True,
        updated_at=default_row.updated_at,
    )


@router.get("/{name}/default")
async def get_default_prompt(
    name: str,
    current_user: User = Depends(get_current_user),
):
    """Get the hardcoded factory default prompt (read-only reference)."""
    if name not in _VALID_NAMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown template name: {name}. Valid: {', '.join(sorted(_VALID_NAMES))}",
        )

    defaults = DEFAULT_PROMPTS[name]
    return {
        "name": name,
        "display_name": TEMPLATE_NAMES.get(name, name),
        "system_prompt": defaults["system_prompt"],
        "user_prompt": defaults["user_prompt"],
        "placeholders": list(PLACEHOLDERS.get(name, [])),
    }


@router.post("/{name}/reset", response_model=PromptTemplateOut)
async def reset_prompt_template(
    name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """Reset a single prompt template: delete ALL DB rows (custom + default).

    Falls back to the hardcoded factory default from prompt_defaults.py.
    """
    if name not in _VALID_NAMES:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown template name: {name}. Valid: {', '.join(sorted(_VALID_NAMES))}",
        )

    stmt = delete(PromptTemplate).where(PromptTemplate.name == name)
    await db.execute(stmt)
    await db.commit()

    return _factory(name)


@router.post("/reset-all", response_model=PromptTemplateListResponse)
async def reset_all_prompt_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_superuser),
):
    """Reset all prompt templates to factory defaults.

    Deletes every row from prompt_templates, both custom and admin-default.
    """
    stmt = delete(PromptTemplate)
    await db.execute(stmt)
    await db.commit()

    templates = [_factory(name) for name in sorted(_VALID_NAMES)]
    return PromptTemplateListResponse(templates=templates)

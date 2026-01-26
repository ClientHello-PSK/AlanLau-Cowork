"""
Skills API - 技能管理 REST API 端点

端点：
- GET /api/skills - 列出所有已安装技能
- GET /api/skills/:name - 获取技能详情
- POST /api/skills/toggle - 启用/禁用技能
- POST /api/skills/create - 创建本地技能
- DELETE /api/skills/:name - 删除本地技能
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Any

from skill_loader import (
    get_all_skills,
    load_skill_content,
    toggle_skill,
    create_local_skill,
    delete_local_skill,
    load_installed_skills
)

router = APIRouter(prefix='/api/skills', tags=['skills'])


class SkillListItem(BaseModel):
    """技能列表项"""
    name: str
    source: str
    enabled: bool
    description: str
    error: Optional[str] = None
    installedAt: Optional[float] = None


class SkillDetail(BaseModel):
    """技能详情"""
    name: str
    source: str
    enabled: bool
    description: str
    content: str
    installedAt: Optional[float] = None


class SkillListResponse(BaseModel):
    """技能列表响应"""
    success: bool
    skills: List[SkillListItem]


class SkillDetailResponse(BaseModel):
    """技能详情响应"""
    success: bool
    skill: SkillDetail


class ErrorResponse(BaseModel):
    """错误响应"""
    success: bool = False
    error: str


class ToggleSkillRequest(BaseModel):
    """切换技能请求"""
    name: str
    enabled: bool


class CreateSkillRequest(BaseModel):
    """创建技能请求"""
    name: str
    content: str


@router.get('/', response_model=SkillListResponse)
async def list_skills(claudeCode: bool = True):
    """
    列出所有已安装技能（本地 + Claude Code）
    
    查询参数：
    - claudeCode: 是否包含 Claude Code 技能（默认 True）
    """
    try:
        skills = await get_all_skills(include_claude_code=claudeCode)
        
        # 返回精简信息（不含完整内容）
        list_items = [
            SkillListItem(
                name=s['name'],
                source=s['source'],
                enabled=s['enabled'],
                description=s['description'],
                error=s.get('error'),
                installedAt=s.get('installedAt')
            )
            for s in skills
        ]
        
        return SkillListResponse(success=True, skills=list_items)
    except Exception as error:
        print(f'[SKILLS API] Failed to list skills: {error}')
        raise HTTPException(status_code=500, detail=str(error))


@router.get('/{name}', response_model=SkillDetailResponse)
async def get_skill(name: str, source: str = 'local'):
    """
    获取技能详情（含完整 SKILL.md 内容）
    
    路径参数：
    - name: 技能名称
    
    查询参数：
    - source: 来源类型（'local' 或 'claude-code'）
    """
    try:
        # 获取已安装技能信息
        installed = load_installed_skills()
        skill_info = next(
            (s for s in installed['skills'] if s['name'] == name),
            None
        )
        
        # 加载内容
        if source == 'claude-code' and skill_info and skill_info.get('path'):
            loaded = load_skill_content(skill_info['path'], 'claude-code')
        else:
            loaded = load_skill_content(name, 'local')
        
        if loaded.error:
            raise HTTPException(status_code=404, detail=loaded.error)
        
        return SkillDetailResponse(
            success=True,
            skill=SkillDetail(
                name=loaded.name,
                source=skill_info.get('source') if skill_info else source,
                enabled=skill_info.get('enabled', False) if skill_info else False,
                description=loaded.description,
                content=loaded.content,
                installedAt=skill_info.get('installedAt') if skill_info else None
            )
        )
    except HTTPException:
        raise
    except Exception as error:
        print(f'[SKILLS API] Failed to get skill: {error}')
        raise HTTPException(status_code=500, detail=str(error))


@router.post('/toggle')
async def toggle_skill_endpoint(request: ToggleSkillRequest):
    """
    启用/禁用技能
    
    请求体：
    - name: 技能名称
    - enabled: 是否启用
    """
    try:
        if not request.name or not isinstance(request.enabled, bool):
            raise HTTPException(
                status_code=400,
                detail='Invalid request: name and enabled (boolean) required'
            )
        
        result = await toggle_skill(request.name, request.enabled)
        
        if not result.success:
            raise HTTPException(status_code=400, detail=result.error)
        
        return {
            'success': True,
            'message': f'Skill "{request.name}" {"enabled" if request.enabled else "disabled"}'
        }
    except HTTPException:
        raise
    except Exception as error:
        print(f'[SKILLS API] Failed to toggle skill: {error}')
        raise HTTPException(status_code=500, detail=str(error))


@router.post('/create')
async def create_skill(request: CreateSkillRequest):
    """
    创建本地技能
    
    请求体：
    - name: 技能名称
    - content: SKILL.md 内容
    """
    try:
        if not request.name or not request.content:
            raise HTTPException(
                status_code=400,
                detail='Invalid request: name and content required'
            )
        
        result = await create_local_skill(request.name, request.content)
        
        if not result.success:
            raise HTTPException(status_code=400, detail=result.error)
        
        return {
            'success': True,
            'message': f'Skill "{request.name}" created'
        }
    except HTTPException:
        raise
    except Exception as error:
        print(f'[SKILLS API] Failed to create skill: {error}')
        raise HTTPException(status_code=500, detail=str(error))


@router.delete('/{name}')
async def delete_skill(name: str):
    """
    删除本地技能
    
    路径参数：
    - name: 技能名称
    """
    try:
        result = await delete_local_skill(name)
        
        if not result.success:
            raise HTTPException(status_code=400, detail=result.error)
        
        return {
            'success': True,
            'message': f'Skill "{name}" deleted'
        }
    except HTTPException:
        raise
    except Exception as error:
        print(f'[SKILLS API] Failed to delete skill: {error}')
        raise HTTPException(status_code=500, detail=str(error))


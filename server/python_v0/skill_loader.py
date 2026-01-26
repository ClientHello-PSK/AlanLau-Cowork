"""
SkillLoader - 技能加载与管理模块

负责：
- 初始化技能目录结构 (~/.occ/skills/)
- 加载本地技能和 Claude Code 兼容技能
- 构建技能上下文 prompt
- 安全过滤危险内容
"""

import os
import json
import re
import shutil
from pathlib import Path
from typing import List, Dict, Optional, Any

# 配置常量
OCC_DIR = Path.home() / '.occ'
SKILLS_DIR = OCC_DIR / 'skills'
INSTALLED_JSON = OCC_DIR / 'installed.json'
MARKETS_JSON = OCC_DIR / 'markets.json'

# 安全限制
MAX_SKILL_SIZE = 50 * 1024  # 50KB per skill
MAX_ENABLED_SKILLS = 20
MAX_PROMPT_CHARS = 30000  # ~10K tokens

# 危险标记黑名单
DANGEROUS_PATTERNS = [
    '</available_skills>',
    '</system>',
    '</user>',
    '</assistant>',
    '<system>',
    '</instructions>',
    '</context>'
]


class SkillLoadResult:
    """技能加载结果"""
    def __init__(self, name: str, content: str = '', description: str = '', 
                 source: str = 'local', error: Optional[str] = None):
        self.name = name
        self.content = content
        self.description = description
        self.source = source
        self.error = error


class OperationResult:
    """操作结果"""
    def __init__(self, success: bool, error: Optional[str] = None):
        self.success = success
        self.error = error
    
    def to_dict(self) -> Dict[str, Any]:
        return {'success': self.success, 'error': self.error}


def init_skills_directory() -> OperationResult:
    """初始化技能目录结构"""
    try:
        # 创建 ~/.occ/ 目录
        OCC_DIR.mkdir(parents=True, exist_ok=True)
        print(f'[SKILLS] Created directory: {OCC_DIR}')
        
        # 创建 skills/ 子目录
        SKILLS_DIR.mkdir(parents=True, exist_ok=True)
        print(f'[SKILLS] Created directory: {SKILLS_DIR}')
        
        # 初始化 installed.json
        if not INSTALLED_JSON.exists():
            initial_data = {'version': 1, 'skills': []}
            INSTALLED_JSON.write_text(json.dumps(initial_data, indent=2))
            print('[SKILLS] Created installed.json')
        
        # 初始化 markets.json
        if not MARKETS_JSON.exists():
            initial_markets = {'version': 1, 'sources': []}
            MARKETS_JSON.write_text(json.dumps(initial_markets, indent=2))
            print('[SKILLS] Created markets.json')
        
        # 验证写入权限
        test_file = OCC_DIR / '.write-test'
        test_file.write_text('test')
        test_file.unlink()
        
        return OperationResult(success=True)
    except Exception as error:
        print(f'[SKILLS] Init error: {error}')
        return OperationResult(success=False, error=str(error))


def load_installed_skills() -> Dict[str, Any]:
    """读取已安装技能索引"""
    try:
        if not INSTALLED_JSON.exists():
            return {'version': 1, 'skills': []}
        
        content = INSTALLED_JSON.read_text(encoding='utf-8')
        data = json.loads(content)
        return data
    except Exception as error:
        print(f'[SKILLS] Failed to load installed.json, creating backup and resetting: {error}')
        
        # 备份损坏的文件
        if INSTALLED_JSON.exists():
            backup_path = INSTALLED_JSON.with_suffix(f'.json.backup.{int(os.path.getmtime(INSTALLED_JSON))}')
            shutil.copy2(INSTALLED_JSON, backup_path)
            print(f'[SKILLS] Backed up corrupted file to: {backup_path}')
        
        # 重建空索引
        initial_data = {'version': 1, 'skills': []}
        INSTALLED_JSON.write_text(json.dumps(initial_data, indent=2))
        return initial_data


def save_installed_skills(data: Dict[str, Any]) -> OperationResult:
    """保存已安装技能索引"""
    try:
        INSTALLED_JSON.write_text(json.dumps(data, indent=2))
        return OperationResult(success=True)
    except Exception as error:
        print(f'[SKILLS] Failed to save installed.json: {error}')
        return OperationResult(success=False, error=str(error))


def sanitize_skill_content(content: str) -> OperationResult:
    """安全过滤技能内容，移除危险标记"""
    if not content or not isinstance(content, str):
        return OperationResult(success=False, error='Invalid content')
    
    # 检查大小限制
    if len(content) > MAX_SKILL_SIZE:
        return OperationResult(
            success=False,
            error=f'Content exceeds {MAX_SKILL_SIZE / 1024}KB limit'
        )
    
    # 检查危险标记
    content_lower = content.lower()
    for pattern in DANGEROUS_PATTERNS:
        if pattern.lower() in content_lower:
            return OperationResult(
                success=False,
                error=f'Contains dangerous pattern: {pattern}'
            )
    
    return OperationResult(success=True)


def extract_description(content: str) -> str:
    """从 SKILL.md 提取描述"""
    # 尝试从 frontmatter 提取
    frontmatter_match = re.match(r'^---\n([\s\S]*?)\n---', content)
    if frontmatter_match:
        frontmatter = frontmatter_match.group(1)
        desc_match = re.search(r'description:\s*(.+)', frontmatter, re.IGNORECASE)
        if desc_match:
            return desc_match.group(1).strip()
    
    # 回退：使用第一个非空行
    lines = [
        line.strip()
        for line in content.split('\n')
        if line.strip() and not line.startswith('#') and not line.startswith('---')
    ]
    return lines[0][:100] if lines else ''


def load_skill_content(skill_name: str, source: str = 'local') -> SkillLoadResult:
    """加载单个技能内容"""
    try:
        if source == 'claude-code':
            # Claude Code 兼容路径
            skill_path = Path(skill_name)
        else:
            # 本地技能路径
            skill_path = SKILLS_DIR / skill_name / 'SKILL.md'
        
        if not skill_path.exists():
            return SkillLoadResult(
                name=skill_name,
                content='',
                description='',
                source=source,
                error='SKILL.md not found'
            )
        
        raw_content = skill_path.read_text(encoding='utf-8')
        
        # 安全过滤
        sanitized = sanitize_skill_content(raw_content)
        if not sanitized.success:
            print(f'[SKILLS] Skill "{skill_name}" rejected: {sanitized.error}')
            return SkillLoadResult(
                name=skill_name,
                content='',
                description='',
                source=source,
                error=sanitized.error
            )
        
        # 解析 frontmatter 提取描述
        description = extract_description(raw_content)
        
        return SkillLoadResult(
            name=skill_name,
            content=sanitized.content,
            description=description,
            source=source
        )
    except Exception as error:
        print(f'[SKILLS] Failed to load skill "{skill_name}": {error}')
        return SkillLoadResult(
            name=skill_name,
            content='',
            description='',
            source=source,
            error=str(error)
        )


def scan_claude_code_skills() -> List[Dict[str, str]]:
    """扫描 Claude Code 插件目录获取可用技能"""
    claude_plugins_dir = Path.home() / '.claude' / 'plugins' / 'cache'
    skills = []
    
    try:
        if not claude_plugins_dir.exists():
            return skills
        
        # 递归扫描 skills/*/SKILL.md
        def scan_dir(dir_path: Path, depth: int = 0):
            if depth > 5:  # 防止无限递归
                return
            
            for entry in dir_path.iterdir():
                if entry.is_dir():
                    if entry.name == 'skills':
                        # 扫描 skills 下的子目录
                        for skill_entry in entry.iterdir():
                            if skill_entry.is_dir():
                                skill_md_path = skill_entry / 'SKILL.md'
                                if skill_md_path.exists():
                                    skills.append({
                                        'name': skill_entry.name,
                                        'path': str(skill_md_path),
                                        'source': 'claude-code'
                                    })
                    else:
                        # 继续递归
                        scan_dir(entry, depth + 1)
        
        scan_dir(claude_plugins_dir)
        print(f'[SKILLS] Found {len(skills)} Claude Code skills')
        return skills
    except Exception as error:
        print(f'[SKILLS] Failed to scan Claude Code skills: {error}')
        return []


async def get_all_skills(include_claude_code: bool = True) -> List[Dict[str, Any]]:
    """获取所有可用技能（本地 + Claude Code）"""
    installed = load_installed_skills()
    all_skills = []
    
    # 加载本地技能
    for skill in installed['skills']:
        loaded = load_skill_content(skill['name'], 'local')
        all_skills.append({
            **skill,
            'content': loaded.content,
            'description': loaded.description or skill.get('description', ''),
            'error': loaded.error
        })
    
    # 扫描 Claude Code 技能
    if include_claude_code:
        claude_skills = scan_claude_code_skills()
        for cs in claude_skills:
            # 检查是否已在 installed 中
            existing = next(
                (s for s in installed['skills'] 
                 if s['name'] == cs['name'] and s['source'] == 'claude-code'),
                None
            )
            if not existing:
                loaded = load_skill_content(cs['path'], 'claude-code')
                all_skills.append({
                    'name': cs['name'],
                    'source': 'claude-code',
                    'enabled': False,  # Claude Code 技能默认禁用
                    'path': cs['path'],
                    'content': loaded.content,
                    'description': loaded.description,
                    'error': loaded.error
                })
    
    return all_skills


async def build_skills_prompt() -> str:
    """构建所有已启用技能的 prompt 片段"""
    installed = load_installed_skills()
    enabled_skills = [s for s in installed['skills'] if s['enabled']]
    
    if not enabled_skills:
        return ''
    
    # 限制启用技能数量
    if len(enabled_skills) > MAX_ENABLED_SKILLS:
        print(
            f'[SKILLS] Too many enabled skills ({len(enabled_skills)}), '
            f'truncating to {MAX_ENABLED_SKILLS}'
        )
        enabled_skills = enabled_skills[:MAX_ENABLED_SKILLS]
    
    prompt_parts = []
    total_chars = 0
    
    for skill in enabled_skills:
        if skill['source'] == 'claude-code' and skill.get('path'):
            loaded = load_skill_content(skill['path'], 'claude-code')
        else:
            loaded = load_skill_content(skill['name'], 'local')
        
        if loaded.error:
            print(f'[SKILLS] Skipping "{skill["name"]}": {loaded.error}')
            continue
        
        # 检查总字符限制
        if total_chars + len(loaded.content) > MAX_PROMPT_CHARS:
            print(f'[SKILLS] Prompt limit reached ({MAX_PROMPT_CHARS} chars), truncating')
            break
        
        prompt_parts.append(f'<skill name="{skill["name"]}">\n{loaded.content}\n</skill>')
        total_chars += len(loaded.content)
    
    return '\n\n'.join(prompt_parts) if prompt_parts else ''


async def create_local_skill(name: str, content: str) -> OperationResult:
    """创建本地技能"""
    try:
        # 验证名称
        if not name or not re.match(r'^[a-zA-Z0-9_-]+$', name):
            return OperationResult(
                success=False,
                error='Invalid skill name (use alphanumeric, _ or -)'
            )
        
        # 安全检查
        sanitized = sanitize_skill_content(content)
        if not sanitized.success:
            return OperationResult(success=False, error=sanitized.error)
        
        # 创建技能目录
        skill_dir = SKILLS_DIR / name
        if skill_dir.exists():
            return OperationResult(success=False, error='Skill already exists')
        
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / 'SKILL.md').write_text(content, encoding='utf-8')
        
        # 添加到 installed.json
        installed = load_installed_skills()
        installed['skills'].append({
            'name': name,
            'source': 'local',
            'enabled': True,
            'installedAt': os.path.getctime(skill_dir)
        })
        save_installed_skills(installed)
        
        print(f'[SKILLS] Created skill: {name}')
        return OperationResult(success=True)
    except Exception as error:
        print(f'[SKILLS] Failed to create skill: {error}')
        return OperationResult(success=False, error=str(error))


async def delete_local_skill(name: str) -> OperationResult:
    """删除本地技能"""
    try:
        skill_dir = SKILLS_DIR / name
        
        if not skill_dir.exists():
            return OperationResult(success=False, error='Skill not found')
        
        # 删除目录
        shutil.rmtree(skill_dir)
        
        # 从 installed.json 移除
        installed = load_installed_skills()
        installed['skills'] = [s for s in installed['skills'] if s['name'] != name]
        save_installed_skills(installed)
        
        print(f'[SKILLS] Deleted skill: {name}')
        return OperationResult(success=True)
    except Exception as error:
        print(f'[SKILLS] Failed to delete skill: {error}')
        return OperationResult(success=False, error=str(error))


async def toggle_skill(name: str, enabled: bool) -> OperationResult:
    """切换技能启用状态"""
    try:
        installed = load_installed_skills()
        skill = next((s for s in installed['skills'] if s['name'] == name), None)
        
        if not skill:
            # 可能是 Claude Code 技能，需要添加到列表
            claude_skills = scan_claude_code_skills()
            claude_skill = next((s for s in claude_skills if s['name'] == name), None)
            
            if claude_skill:
                installed['skills'].append({
                    'name': name,
                    'source': 'claude-code',
                    'path': claude_skill['path'],
                    'enabled': enabled,
                    'installedAt': os.path.getctime(claude_skill['path'])
                })
            else:
                return OperationResult(success=False, error='Skill not found')
        else:
            skill['enabled'] = enabled
        
        save_installed_skills(installed)
        print(f'[SKILLS] Toggled "{name}" to {enabled}')
        return OperationResult(success=True)
    except Exception as error:
        print(f'[SKILLS] Failed to toggle skill: {error}')
        return OperationResult(success=False, error=str(error))


async def seed_example_skill():
    """预置示例技能（首次启动时调用）"""
    example_name = 'example-skill'
    example_dir = SKILLS_DIR / example_name
    
    if example_dir.exists():
        return  # 已存在，跳过
    
    example_content = """---
name: example-skill
description: 一个示例技能，展示 SKILL.md 的格式
---

# 示例技能

## Overview
这是一个示例技能，用于演示技能格式。你可以参考这个文件创建自己的技能。

## When to Use
当用户询问如何创建技能时，可以参考此示例。

## Instructions
1. 在 ~/.occ/skills/ 目录下创建一个新文件夹
2. 在文件夹中创建 SKILL.md 文件
3. 使用 YAML frontmatter 定义 name 和 description
4. 在正文中编写技能的具体指令

## Example Usage
用户: "如何创建一个代码审查技能？"
助手: 参考 example-skill 的格式，创建一个包含代码审查规则的 SKILL.md 文件。
"""
    
    try:
        example_dir.mkdir(parents=True, exist_ok=True)
        (example_dir / 'SKILL.md').write_text(example_content, encoding='utf-8')
        
        # 添加到 installed.json（默认禁用）
        installed = load_installed_skills()
        if not any(s['name'] == example_name for s in installed['skills']):
            installed['skills'].append({
                'name': example_name,
                'source': 'local',
                'enabled': False,
                'installedAt': os.path.getctime(example_dir)
            })
            save_installed_skills(installed)
        
        print('[SKILLS] Seeded example skill')
    except Exception as error:
        print(f'[SKILLS] Failed to seed example skill: {error}')


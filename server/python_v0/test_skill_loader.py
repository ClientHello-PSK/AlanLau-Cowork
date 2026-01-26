"""
Skill Loader 测试文件
测试技能加载、管理和安全过滤功能
"""

import pytest
import asyncio
from pathlib import Path
from skill_loader import (
    init_skills_directory,
    load_installed_skills,
    save_installed_skills,
    sanitize_skill_content,
    extract_description,
    load_skill_content,
    get_all_skills,
    create_local_skill,
    delete_local_skill,
    toggle_skill,
    SKILLS_DIR,
    INSTALLED_JSON
)


@pytest.fixture
async def setup_skills():
    """设置测试技能目录"""
    # 初始化技能目录
    result = init_skills_directory()
    assert result.success
    
    yield
    
    # 清理：删除测试技能
    if SKILLS_DIR.exists():
        import shutil
        shutil.rmtree(SKILLS_DIR)


class TestSkillInitialization:
    """测试技能初始化"""
    
    def test_init_skills_directory(self):
        """测试技能目录初始化"""
        result = init_skills_directory()
        assert result.success
        assert SKILLS_DIR.exists()
        assert INSTALLED_JSON.exists()
    
    def test_load_installed_skills(self):
        """测试加载已安装技能"""
        data = load_installed_skills()
        assert 'version' in data
        assert 'skills' in data
        assert isinstance(data['skills'], list)


class TestSkillSanitization:
    """测试技能内容安全过滤"""
    
    def test_sanitize_valid_content(self):
        """测试有效内容"""
        content = """
---
name: test-skill
description: A test skill
---
# Test Skill
This is a safe skill.
        """
        result = sanitize_skill_content(content)
        assert result.success
    
    def test_sanitize_too_large(self):
        """测试过大内容"""
        content = "x" * (51 * 1024)  # 超过 50KB
        result = sanitize_skill_content(content)
        assert not result.success
        assert 'exceeds' in result.error.lower()
    
    def test_sanitize_dangerous_pattern(self):
        """测试危险模式"""
        dangerous_patterns = [
            '</available_skills>',
            '</system>',
            '</user>',
            '</assistant>',
            '<system>',
            '</instructions>'
        ]
        
        for pattern in dangerous_patterns:
            result = sanitize_skill_content(f"Safe content\n{pattern}\nMore content")
            assert not result.success, f"Pattern '{pattern}' should be rejected"
    
    def test_sanitize_empty_content(self):
        """测试空内容"""
        result = sanitize_skill_content("")
        assert not result.success
        assert 'invalid' in result.error.lower()
    
    def test_sanitize_dangerous_functions(self):
        """测试危险函数（需实现后验证）"""
        # 当前实现未检测危险函数，此测试需要修复 #6 后启用
        pass


class TestSkillExtraction:
    """测试技能信息提取"""
    
    def test_extract_description_from_frontmatter(self):
        """测试从 frontmatter 提取描述"""
        content = """---
description: This is a test description
other_field: value
---
# Content
        """
        description = extract_description(content)
        assert 'test description' in description.lower()
    
    def test_extract_description_from_first_line(self):
        """测试从第一行提取描述"""
        content = """
# Test Skill

This skill does something.
        """
        description = extract_description(content)
        assert 'test skill' in description.lower() or 'skill does' in description.lower()


class TestSkillOperations:
    """测试技能操作"""
    
    @pytest.mark.asyncio
    async def test_create_skill(self):
        """测试创建技能"""
        name = 'test-create-skill'
        content = f"""---
name: {name}
description: Test skill creation
---
# Test
        """
        
        result = await create_local_skill(name, content)
        assert result.success
        assert (SKILLS_DIR / name / 'SKILL.md').exists()
    
    @pytest.mark.asyncio
    async def test_create_invalid_skill_name(self):
        """测试无效技能名称"""
        invalid_names = ['test space', 'test/slash', 'test\\backslash', '']
        
        for name in invalid_names:
            result = await create_local_skill(name, 'Content')
            assert not result.success
    
    @pytest.mark.asyncio
    async def test_delete_skill(self):
        """测试删除技能"""
        # 先创建
        name = 'test-delete-skill'
        await create_local_skill(name, 'Content')
        
        # 再删除
        result = await delete_local_skill(name)
        assert result.success
        assert not (SKILLS_DIR / name).exists()
    
    @pytest.mark.asyncio
    async def test_toggle_skill(self):
        """测试切换技能状态"""
        name = 'test-toggle-skill'
        await create_local_skill(name, 'Content')
        
        # 启用
        result1 = await toggle_skill(name, True)
        assert result1.success
        
        data = load_installed_skills()
        skill = next((s for s in data['skills'] if s['name'] == name), None)
        assert skill['enabled'] == True
        
        # 禁用
        result2 = await toggle_skill(name, False)
        assert result2.success
        
        data = load_installed_skills()
        skill = next((s for s in data['skills'] if s['name'] == name), None)
        assert skill['enabled'] == False


class TestSkillLoading:
    """测试技能加载"""
    
    @pytest.mark.asyncio
    async def test_load_skill_content(self):
        """测试加载技能内容"""
        # 创建测试技能
        name = 'test-load-skill'
        content = f"""---
name: {name}
description: Load test
---
# Test Content
        """
        await create_local_skill(name, content)
        
        # 加载
        result = load_skill_content(name, 'local')
        assert result.name == name
        assert result.content
        assert 'Test Content' in result.content
        assert result.error is None
    
    @pytest.mark.asyncio
    async def test_get_all_skills(self):
        """测试获取所有技能"""
        skills = await get_all_skills(include_claude_code=False)
        assert isinstance(skills, list)
        # 应该至少有预置的 example-skill


if __name__ == '__main__':
    pytest.main([__file__, '-v'])




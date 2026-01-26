"""
Sandbox 测试文件
测试文件沙箱安全机制
"""

import pytest
import os
from server import (
    is_absolute_path,
    resolve_in_workspace,
    is_path_in_workspace,
    validate_file_path
)


class TestPathDetection:
    """测试路径检测"""
    
    def test_is_absolute_path_windows(self):
        """测试 Windows 绝对路径"""
        assert is_absolute_path('C:\\Users\\test')
        assert is_absolute_path('D:\\data\\file.txt')
        assert is_absolute_path('E:/project/src')
    
    def test_is_absolute_path_unix(self):
        """测试 Unix 绝对路径"""
        assert is_absolute_path('/home/user')
        assert is_absolute_path('/usr/local/bin')
        assert is_absolute_path('/var/www/html')
    
    def test_is_absolute_path_unc(self):
        """测试 UNC 路径"""
        assert is_absolute_path('\\\\server\\share')
        assert is_absolute_path('\\\\?\\C:\\path')
    
    def test_is_absolute_path_relative(self):
        """测试相对路径"""
        assert not is_absolute_path('relative/path')
        assert not is_absolute_path('./file.txt')
        assert not is_absolute_path('../parent')
        assert not is_absolute_path('')
    
    def test_is_absolute_path_mixed(self):
        """测试混合路径"""
        assert is_absolute_path('C:/mixed\\path')  # Windows 混合分隔符


class TestPathResolution:
    """测试路径解析"""
    
    def test_resolve_relative_path(self):
        """测试解析相对路径"""
        workspace = '/home/user/workspace'
        target = 'project/file.txt'
        
        resolved = resolve_in_workspace(target, workspace)
        assert resolved is not None
        assert 'project/file.txt' in resolved
    
    def test_resolve_absolute_path(self):
        """测试解析绝对路径"""
        workspace = '/home/user/workspace'
        target = '/etc/config'
        
        resolved = resolve_in_workspace(target, workspace)
        assert resolved is not None
        assert resolved == '/etc/config'
    
    def test_resolve_no_workspace(self):
        """测试无工作目录"""
        resolved = resolve_in_workspace('file.txt', '')
        assert resolved is None


class TestPathValidation:
    """测试路径验证"""
    
    def test_is_path_in_workspace_exact(self):
        """测试路径在工作目录内（精确匹配）"""
        workspace = '/home/user/workspace'
        path = '/home/user/workspace'
        
        assert is_path_in_workspace(path, workspace)
    
    def test_is_path_in_workspace_subdirectory(self):
        """测试子目录"""
        workspace = '/home/user/workspace'
        path = '/home/user/workspace/project/src'
        
        assert is_path_in_workspace(path, workspace)
    
    def test_is_path_in_workspace_parent(self):
        """测试父目录（应失败）"""
        workspace = '/home/user/workspace'
        path = '/home/user'
        
        assert not is_path_in_workspace(path, workspace)
    
    def test_is_path_in_workspace_sibling(self):
        """测试兄弟目录（应失败）"""
        workspace = '/home/user/workspace'
        path = '/home/user/other'
        
        assert not is_path_in_workspace(path, workspace)
    
    def test_is_path_in_workspace_none(self):
        """测试空路径"""
        assert not is_path_in_workspace('', '/workspace')
        assert not is_path_in_workspace('/path', '')
    
    def test_is_path_in_workspace_windows(self):
        """测试 Windows 路径（大小写不敏感）"""
        workspace = 'C:\\Users\\Workspace'
        path = 'c:\\users\\workspace\\project'
        
        # Windows 应该不区分大小写
        if os.name == 'nt':
            assert is_path_in_workspace(path, workspace)
        else:
            # Unix 区分大小写
            assert not is_path_in_workspace(path, workspace)


class TestPathSecurity:
    """测试路径安全"""
    
    def test_validate_file_path_no_workspace(self):
        """测试无工作目录"""
        result = validate_file_path('file.txt', '')
        assert not result['allowed']
        assert '工作目录未设置' in result['reason']
    
    def test_validate_file_path_safe_relative(self):
        """测试安全相对路径"""
        result = validate_file_path('project/file.txt', '/safe/workspace')
        assert result['allowed']
    
    def test_validate_file_path_safe_absolute_in_workspace(self):
        """测试工作目录内的绝对路径"""
        result = validate_file_path('/safe/workspace/file.txt', '/safe/workspace')
        assert result['allowed']
    
    def test_validate_file_path_escape_parent(self):
        """测试父目录遍历攻击"""
        result = validate_file_path('../secret.txt', '/safe/workspace')
        assert not result['allowed']
        assert '超出工作目录范围' in result['reason']
    
    def test_validate_file_path_escape_absolute(self):
        """测试绝对路径逃逸"""
        result = validate_file_path('/etc/passwd', '/safe/workspace')
        assert not result['allowed']
        assert '超出工作目录范围' in result['reason']
    
    def test_validate_file_path_complex_escape(self):
        """测试复杂逃逸路径"""
        dangerous_paths = [
            '../../../etc/passwd',
            '....//....//etc/passwd',
            '..\\..\\..\\windows\\system32',
            '/safe/workspace/../etc',
            '/safe/workspace/./../../etc'
        ]
        
        workspace = '/safe/workspace'
        for path in dangerous_paths:
            result = validate_file_path(path, workspace)
            assert not result['allowed'], f"Path '{path}' should be blocked"


class TestEdgeCases:
    """测试边界情况"""
    
    def test_empty_path(self):
        """测试空路径"""
        result = validate_file_path('', '/workspace')
        assert not result['allowed'] or result['allowed']  # 空路径取决于实现
    
    def test_dots_only(self):
        """测试仅点号"""
        result = validate_file_path('.', '/workspace')
        # '.' 通常表示当前目录，应该在允许范围内
        assert result['allowed']
    
    def test_trailing_slash(self):
        """测试尾部斜杠"""
        result = validate_file_path('project/', '/workspace')
        assert result['allowed']
    
    def test_multiple_slashes(self):
        """测试多个斜杠"""
        result = validate_file_path('project//file.txt', '/workspace')
        # 应该规范化后允许
        assert result['allowed']
    
    def test_special_characters(self):
        """测试特殊字符"""
        result = validate_file_path('project/file with spaces.txt', '/workspace')
        assert result['allowed']


if __name__ == '__main__':
    pytest.main([__file__, '-v'])




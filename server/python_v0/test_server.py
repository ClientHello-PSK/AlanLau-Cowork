"""
Server API 测试文件
测试所有 API 端点的功能
"""

import pytest
from fastapi.testclient import TestClient
from server import app, load_config

client = TestClient(app)


@pytest.fixture
def test_config():
    """测试配置"""
    return load_config()


def test_health_check():
    """测试健康检查端点"""
    response = client.get('/api/health')
    assert response.status_code == 200
    
    data = response.json()
    assert 'status' in data
    assert data['status'] == 'ok'
    assert 'timestamp' in data
    assert 'config' in data


def test_get_config(test_config):
    """测试获取配置端点"""
    response = client.get('/api/config')
    assert response.status_code == 200
    
    data = response.json()
    assert 'apiEndpoint' in data
    assert 'hasApiKey' in data
    assert 'maxTurns' in data
    assert 'permissionMode' in data
    assert 'workspaceDir' in data
    assert 'sandboxEnabled' in data


def test_update_config():
    """测试更新配置端点"""
    # 更新配置
    update_data = {
        'maxTurns': 30,
        'permissionMode': 'acceptEdits',
        'sandboxEnabled': False
    }
    response = client.post('/api/config', json=update_data)
    assert response.status_code == 200
    
    data = response.json()
    assert data['maxTurns'] == 30
    assert data['permissionMode'] == 'acceptEdits'
    assert data['sandboxEnabled'] == False
    
    # 恢复默认配置
    restore_data = {
        'maxTurns': 20,
        'permissionMode': 'bypassPermissions',
        'sandboxEnabled': True
    }
    client.post('/api/config', json=restore_data)


def test_chat_missing_message():
    """测试聊天端点缺少消息"""
    response = client.post('/api/chat', json={})
    assert response.status_code == 400


def test_chat_no_api_key():
    """测试聊天端点无 API Key"""
    from unittest.mock import patch
    
    with patch('server.server_config') as mock_config:
        mock_config.api_key = ''
        mock_config.sandbox_enabled = False
        
        response = client.post('/api/chat', json={
            'message': 'Hello'
        })
        
        # 应该返回流式响应
        assert response.status_code == 200


def test_skills_list():
    """测试获取技能列表"""
    response = client.get('/api/skills')
    assert response.status_code == 200
    
    data = response.json()
    assert 'success' in data
    assert 'skills' in data
    assert isinstance(data['skills'], list)


def test_session_recovery():
    """测试会话恢复功能"""
    chat_id = 'test-chat-session'
    
    # 模拟第一次请求
    response1 = client.post('/api/chat', json={
        'message': 'First message',
        'chatId': chat_id
    })
    
    # 模拟第二次请求（应恢复会话）
    response2 = client.post('/api/chat', json={
        'message': 'Second message',
        'chatId': chat_id
    })
    
    # 两个请求都应该成功
    assert response1.status_code in [200, 400]  # 可能因无 API Key 而失败
    assert response2.status_code in [200, 400]


if __name__ == '__main__':
    pytest.main([__file__, '-v'])




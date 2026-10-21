from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
import networkx as nx
from networkx.readwrite import json_graph
import requests
import json
import re
import os  

app = Flask(__name__, static_folder='static')
CORS(app)

# =============================================
# 配置区
# =============================================
USE_REAL_AI = True  # 保持 True 启用真实 AI
# 请将下方替换为你的 OpenRouter API Key（从 https://openrouter.ai/keys 获取）
# 替换为真实 Key
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "sk-or-v1-你的密钥")
# =============================================

# ========== 构建校园网拓扑 ==========
G = nx.Graph()
devices = [
    "图书馆核心", "教学楼汇聚", "宿舍楼汇聚", "行政楼汇聚",
    "出口防火墙", "Web服务器群", "数据中心核心"
]
G.add_nodes_from(devices)
G.add_edges_from([
    ("图书馆核心", "教学楼汇聚"),
    ("图书馆核心", "宿舍楼汇聚"),
    ("图书馆核心", "行政楼汇聚"),
    ("图书馆核心", "出口防火墙"),
    ("图书馆核心", "数据中心核心"),
    ("教学楼汇聚", "Web服务器群"),
    ("数据中心核心", "Web服务器群")
])
for node in G.nodes:
    G.nodes[node]['label'] = node
print(f"✅ 校园网拓扑：{G.number_of_nodes()} 设备，{G.number_of_edges()} 链路")

# ========== 路由 ==========
@app.route('/')
def serve_frontend():
    return send_from_directory('static', 'indexx.html')

@app.route('/api/topology')
def get_topology():
    data = json_graph.node_link_data(G)
    return jsonify(data)

# ---------- 原有的 GET 接口（基于静态拓扑） ----------
@app.route('/api/shortest_path/<source>/<target>')
def get_shortest_path(source, target):
    try:
        path_names = nx.shortest_path(G, source=source, target=target)
        return jsonify({"path": path_names})
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return jsonify({"path": []})

# ---------- 新增：POST 接口（基于动态拓扑） ----------
@app.route('/api/shortest_path', methods=['POST'])
def get_shortest_path_post():
    """
    接收前端发来的拓扑数据（nodes + edges），计算 source 到 target 的最短路径
    请求体格式：
    {
        "source": "节点ID",
        "target": "节点ID",
        "nodes": [{"id": "id1", ...}, ...],
        "edges": [{"from": "id1", "to": "id2"}, ...]
    }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "缺少请求体"}), 400

    source = data.get('source')
    target = data.get('target')
    nodes_data = data.get('nodes', [])
    edges_data = data.get('edges', [])

    if not source or not target:
        return jsonify({"error": "缺少源或目标"}), 400

    # 构建临时 NetworkX 图
    temp_G = nx.Graph()
    for n in nodes_data:
        temp_G.add_node(n['id'])
    for e in edges_data:
        temp_G.add_edge(e['from'], e['to'])

    try:
        path = nx.shortest_path(temp_G, source=source, target=target)
        return jsonify({"path": path})
    except nx.NetworkXNoPath:
        return jsonify({"path": []})
    except nx.NodeNotFound:
        return jsonify({"error": "节点不存在"}), 400

# =============================================
# 模拟解析（备用）
# =============================================
def mock_parse_requirements(text):
    """基于关键词的模拟解析（无需API Key）"""
    devices = []
    tech_features = []
    
    if "R4" in text and "ISP" in text:
        devices.append({"id": "R4", "role": "ISP", "tasks": ["配置公网IP", "配置默认路由", "不运行动态路由"]})
    if "R3" in text and "MGRE" in text and "中心" in text:
        devices.append({"id": "R3", "role": "MGRE_Hub", "tasks": ["mGRE隧道", "NHRP服务器", "OSPF广播", "路由汇总", "区域认证"]})
    for router in ["R5", "R6", "R7"]:
        if router in text and "MGRE" in text:
            devices.append({"id": router, "role": "MGRE_Spoke", "tasks": ["mGRE隧道", "NHRP客户端", "OSPF广播", "区域认证"]})
    if "R12" in text and "环回" in text:
        devices.append({"id": "R12", "role": "普通路由器", "tasks": ["配置两个环回口", "OSPF宣告环回"]})
    for router in ["R1", "R2"]:
        if router in text and not any(d['id'] == router for d in devices):
            devices.append({"id": router, "role": "普通路由器", "tasks": ["配置OSPF", "配置环回口"]})
    if not devices:
        devices.append({"id": "未识别", "role": "请检查输入", "tasks": ["确保包含设备名称", "示例：R4为ISP"]})
    
    if "MGRE" in text: tech_features.append("MGRE")
    if "OSPF" in text: tech_features.append("OSPF")
    if "NHRP" in text: tech_features.append("NHRP")
    if "认证" in text: tech_features.append("OSPF认证")
    if "LSA" in text or "更新量" in text: tech_features.append("OSPF优化（Stub/汇总）")
    if "收敛" in text: tech_features.append("OSPF收敛优化")
    if "公网" in text: tech_features.append("公网IP地址")
    
    return {"devices": devices, "tech_features": tech_features}

# =============================================
# 真实 AI 解析（OpenRouter）
# =============================================
def openrouter_parse_requirements(text):
    import re 
    system_prompt = """
你是一个网络架构专家。根据用户描述，提取所有设备及其角色和配置任务。

**重要：用户可能使用中文或英文名称（例如：Core-1、汇聚交换机-1、FW-1）。请逐一列出所有提到的设备，不要遗漏任何一台。**

输出必须为纯 JSON 格式，结构如下：
{
  "devices": [
    {"id": "设备标识", "role": "设备角色", "tasks": ["配置任务1", "配置任务2"]}
  ],
  "tech_features": ["技术特性1", "技术特性2"]
}

角色包括：核心交换机、汇聚交换机、接入交换机、防火墙、路由器、服务器、ISP等。

只输出 JSON，不要任何额外文字或解释。
"""
    
    try:
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5000",
                "X-Title": "Network Topology Designer"
            },
            json={
                "model": "nvidia/nemotron-3-super-120b-a12b:free",  # 指定该模型
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"需求：{text}"}
                ],
                "temperature": 0.1,
                "max_tokens": 2000
            },
            timeout=60
        )
        
        if response.status_code != 200:
            return {"error": f"AI接口调用失败: {response.text}"}
        
        result = response.json()
        content = result['choices'][0]['message']['content']
        
        # 🔍 打印原始返回内容（用于调试）
        print(f"🔍 AI原始返回内容: {content}")
        
        # ========== 强化 JSON 提取 ==========
        json_str = None
        
        # 方式1：匹配 ```json ... ``` 代码块
        code_match = re.search(r'```json\s*([\s\S]*?)\s*```', content, re.DOTALL)
        if code_match:
            json_str = code_match.group(1).strip()
            print("✅ 从代码块中提取 JSON")
        
        # 方式2：如果没找到代码块，尝试匹配最外层花括号
        if not json_str:
            brace_start = content.find('{')
            if brace_start != -1:
                # 用栈匹配最外层大括号
                depth = 0
                for i in range(brace_start, len(content)):
                    if content[i] == '{':
                        depth += 1
                    elif content[i] == '}':
                        depth -= 1
                        if depth == 0:
                            json_str = content[brace_start:i+1]
                            print("✅ 从原始文本中提取 JSON")
                            break
        
        if not json_str:
            return {"error": f"未找到JSON。原始内容: {content[:300]}"}
        
        # 尝试解析 JSON
        try:
            parsed = json.loads(json_str)
        except json.JSONDecodeError as e:
            # 如果失败，尝试使用正则清理一些常见干扰字符
            import re
            cleaned = re.sub(r'[\x00-\x1f]+', ' ', json_str)  # 移除控制字符
            try:
                parsed = json.loads(cleaned)
            except:
                return {"error": f"JSON解析失败: {str(e)}，内容: {json_str[:200]}"}
        
        # ========== 强制修正数据格式 ==========
        devices_from_top = []
        if 'id' in parsed and 'role' in parsed:
            devices_from_top.append({
                'id': parsed['id'],
                'role': parsed['role'],
                'tasks': parsed.get('tasks', [])
            })
            parsed.pop('id', None)
            parsed.pop('role', None)
            parsed.pop('tasks', None)
        
        if 'devices' not in parsed:
            parsed['devices'] = []
        
        if len(parsed['devices']) == 0 and devices_from_top:
            parsed['devices'] = devices_from_top
        
        # 确保 devices 是数组
        if not isinstance(parsed['devices'], list):
            parsed['devices'] = []
        
        if 'tech_features' not in parsed:
            parsed['tech_features'] = []
        if not isinstance(parsed['tech_features'], list):
            parsed['tech_features'] = []
        
        return parsed
        
    except Exception as e:
        return {"error": f"AI解析异常: {str(e)}"}

# =============================================
# 统一解析接口
# =============================================
@app.route('/api/parse_requirements', methods=['POST'])
def parse_requirements():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求体必须为JSON格式"}), 400
        
        user_text = data.get('text', '').strip()
        if not user_text:
            return jsonify({"error": "请输入需求内容"}), 400
        
        # 根据配置选择解析方式
        if USE_REAL_AI and OPENROUTER_API_KEY and OPENROUTER_API_KEY != "sk-or-v1-你的OpenRouter密钥":
            result = openrouter_parse_requirements(user_text)
            if "error" in result:
                print(f"⚠️ AI解析失败，降级到模拟解析: {result['error']}")
                result = mock_parse_requirements(user_text)
        else:
            result = mock_parse_requirements(user_text)
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({"error": f"服务器错误: {str(e)}"}), 500

# =============================================
# 启动
# =============================================
if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5000)
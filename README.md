# AI网络拓扑设计器

基于 Flask + Vis.js + NetworkX + OpenRouter 的智能网络拓扑生成工具。

## 功能
- 手动编辑拓扑（添加/删除/连线/改名/撤销）
- AI语义解析（输入文字自动生成拓扑）
- 最短路径计算与高亮
- 拓扑保存与加载

## 技术栈
- 后端：Flask + NetworkX
- 前端：Vis.js + 原生JS
- AI：OpenRouter API

## 快速开始
```bash
pip install flask flask-cors networkx requests
set OPENROUTER_API_KEY=你的密钥
python app.py

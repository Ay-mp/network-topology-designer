// =================================================================
// 全局变量
// =================================================================
let network;
let nodes;
let edges;
let linkMode = false;
let deleteMode = false;
let boxSelectMode = false;
let firstNodeId = null;
// 最短路径交互状态
let pathSourceId = null;        // 当前选中的起点ID
let pathTargetId = null;        // 当前选中的终点ID
let isSelectingPath = false;    // 是否处于路径选择模式

// 历史记录
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 50;

// 框选相关
let isSelecting = false;
let startX, startY;
const selectionBox = document.getElementById('selection-box');

// 设备颜色/形状映射
const deviceColors = {
    '接入交换机': '#32c864',
    '无线AP': '#32c864',
    '光猫/ONU': '#32c864',
    '汇聚交换机': '#ffc832',
    'AC控制器': '#ffc832',
    '核心交换机': '#ff6432',
    '路由器': '#ff6432',
    '防火墙': '#ff6432',
    '行为管理': '#aa66cc',
    '负载均衡': '#aa66cc',
    '服务器': '#aa66cc',
    'OLT': '#aa66cc'
};
const deviceShapes = {
    '接入交换机': 'box',
    '无线AP': 'dot',
    '光猫/ONU': 'diamond',
    '汇聚交换机': 'box',
    'AC控制器': 'dot',
    '核心交换机': 'star',
    '路由器': 'triangle',
    '防火墙': 'square',
    '行为管理': 'box',
    '负载均衡': 'box',
    '服务器': 'square',
    'OLT': 'box'
};

// =================================================================
// 初始化
// =================================================================
async function drawNetwork() {
    try {
        const saved = localStorage.getItem('topologyData');
        let data;
        if (saved) {
            data = JSON.parse(saved);
            console.log('从本地存储加载拓扑');
        } else {
            const response = await fetch('/api/topology');
            data = await response.json();
            console.log('从后端加载默认校园网拓扑');
            localStorage.setItem('topologyData', JSON.stringify(data));
        }

        nodes = new vis.DataSet(data.nodes.map(n => ({
            id: n.id,
            label: n.label,
            color: n.color || '#4fc3f7',
            size: n.size || 14,
            shape: n.shape || 'dot',
            font: { size: 12, color: '#ffffff', background: 'rgba(0,0,0,0.2)', strokeWidth: 1 },
            borderWidth: 0,
            x: n.x,
            y: n.y
        })));

        edges = new vis.DataSet(data.edges.map(e => ({
            from: e.from || e.source,
            to: e.to || e.target,
            color: { color: '#5a7a9a', highlight: '#ff6b6b' },
            width: 2,
            smooth: { type: 'continuous' }
        })));

        const container = document.getElementById('mynetwork');
        const options = {
            nodes: { shape: 'dot', size: 14, font: { size: 14, color: '#ffffff' } },
            edges: { smooth: { type: 'continuous' }, width: 2 },
            physics: {
                enabled: true,
                stabilization: { enabled: true, iterations: 100 },
                barnesHut: { gravitationalConstant: -2000, centralGravity: 0.3, springLength: 150 }
            },
            interaction: { hover: true, tooltipDelay: 100 }
        };

        network = new vis.Network(container, { nodes, edges }, options);
        console.log('✅ 拓扑图渲染成功！');

        network.on("stabilizationIterationsDone", function () {
            network.setOptions({ physics: false });
            console.log('✅ 物理引擎已稳定并关闭');
        });

        // ---------- 点击事件：最短路径高亮 ----------
       // ---------- 点击事件：最短路径选择 + 高亮 ----------
// ---------- 点击事件：最短路径选择 + 高亮 ----------
network.on("click", function(params) {
    // 优先处理模式（连线/删除/框选）
    if (linkMode) { handleLinkModeClick(params); return; }
    if (deleteMode) { handleDeleteModeClick(params); return; }
    if (boxSelectMode) return;

    // 如果点击的是节点
    if (params.nodes.length === 1) {
        const nodeId = params.nodes[0];
        const node = nodes.get(nodeId);
        if (!node) return;

        // ----- 路径选择模式逻辑 -----
        if (!isSelectingPath) {
            // 第一次点击：选择起点
            pathSourceId = nodeId;
            isSelectingPath = true;
            // 高亮起点（绿色）
            nodes.update({ id: nodeId, color: '#00ff88', size: 24 });
            document.getElementById('modeHint').innerHTML = `📍 起点: ${node.label}，请点击终点`;
            document.getElementById('pathDisplay').innerHTML = `📍 已选起点: <b>${node.label}</b>，请点击终点`;
            document.getElementById('pathDisplay').style.borderColor = '#00ff88';
            document.getElementById('pathDisplay').style.color = '#00ff88';
            return;
        }

        if (isSelectingPath && pathSourceId) {
            // 第二次点击：选择终点
            const sourceId = pathSourceId;
            const targetId = nodeId;

            // 如果起点和终点相同，重置状态
            if (sourceId === targetId) {
                resetPathSelection();
                document.getElementById('modeHint').innerHTML = '⚠️ 起点和终点不能相同，已重置';
                return;
            }

            // ========== 修改：POST 请求，携带拓扑数据 ==========
            fetch('/api/shortest_path', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source: sourceId,
                    target: targetId,
                    nodes: nodes.get(),
                    edges: edges.get()
                })
            })
            .then(r => r.json())
            .then(result => {
                const pathNames = result.path;
                const display = document.getElementById('pathDisplay');
                if (pathNames && pathNames.length > 0) {
                    resetHighlight();
                    highlightPath(pathNames);
                    const sourceLabel = nodes.get(sourceId).label;
                    const targetLabel = nodes.get(targetId).label;
                    display.innerHTML = `🚀 最短路径: <b>${sourceLabel}</b> → <b>${pathNames.map(id => nodes.get(id).label).join(' → ')}</b> → <b>${targetLabel}</b>`;
                    display.style.borderColor = '#ff6b6b';
                    display.style.color = '#ff6b6b';
                    document.getElementById('modeHint').innerHTML = `✅ 路径已高亮 (${sourceLabel} → ${targetLabel})`;
                } else {
                    display.innerHTML = `⚠️ 从 ${nodes.get(sourceId).label} 到 ${nodes.get(targetId).label} 不可达`;
                    display.style.borderColor = '#ffd93d';
                    display.style.color = '#ffd93d';
                    document.getElementById('modeHint').innerHTML = '⚠️ 路径不可达';
                }
            })
            .catch(() => {
                document.getElementById('pathDisplay').innerHTML = '❌ 后端请求失败';
            })
            .finally(() => {
                resetPathSelection();
            });
            return;
        }
    } else {
        // 点击空白区域：重置路径选择
        if (isSelectingPath) {
            resetPathSelection();
            document.getElementById('modeHint').innerHTML = '💡 已取消路径选择';
        }
        // 同时清除高亮
        resetHighlight();
        const display = document.getElementById('pathDisplay');
        display.innerHTML = '💡 点击节点选择起点，再点击节点选择终点查看最短路径';
        display.style.borderColor = '#00d4ff';
        display.style.color = '#00d4ff';
    }
});

        // ---------- 双击事件：重命名节点 ----------
        network.on("doubleClick", function(params) {
            // 如果在模式中（连线、删除、框选）禁止改名，避免干扰
            if (linkMode || deleteMode || boxSelectMode) return;
            if (params.nodes.length === 1) {
                const nodeId = params.nodes[0];
                const node = nodes.get(nodeId);
                if (!node) return;
                const newLabel = prompt("请输入新的设备名称：", node.label);
                if (newLabel !== null && newLabel.trim() !== "") {
                    const oldLabel = node.label;
                    const newName = newLabel.trim();
                    // 更新节点标签
                    nodes.update({ id: nodeId, label: newName });
                    // 记录历史（重命名）
                    pushHistory({ type: 'renameNode', nodeId: nodeId, oldLabel: oldLabel, newLabel: newName });
                    document.getElementById('modeHint').innerHTML = `✏️ 已将 "${oldLabel}" 改名为 "${newName}"`;
                } else if (newLabel !== null) {
                    document.getElementById('modeHint').innerHTML = '⚠️ 名称不能为空，取消改名';
                }
            }
        });

        nodes.on('*', function() { saveTopology(); });
        edges.on('*', function() { saveTopology(); });

        // 键盘快捷键
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo(); else undo();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                redo();
            }
            if (e.key === 'Delete' && boxSelectMode) {
                deleteSelectedNodes();
            }
        });

        // 框选鼠标事件绑定（使用 container）
        container.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

    } catch (error) {
        console.error('初始化失败:', error);
    }
}

// =================================================================
// 设备添加
// =================================================================
function addDevice(deviceType) {
    const id = deviceType + '-' + Date.now();
    const container = document.getElementById('mynetwork');
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2 + (Math.random() - 0.5) * 100;
    const centerY = rect.height / 2 + (Math.random() - 0.5) * 100;
    const newNode = {
        id: id,
        label: deviceType,
        color: deviceColors[deviceType] || '#4fc3f7',
        size: 14,
        shape: deviceShapes[deviceType] || 'dot',
        x: centerX,
        y: centerY,
        font: { size: 12, color: '#ffffff', background: 'rgba(0,0,0,0.2)', strokeWidth: 1 },
        borderWidth: 0
    };
    nodes.add(newNode);
    pushHistory({ type: 'addNode', node: newNode });
    document.getElementById('modeHint').innerHTML = `✅ 已添加 ${deviceType}`;
}

// =================================================================
// 连线模式
// =================================================================
function toggleLinkMode() {
    linkMode = !linkMode;
    deleteMode = false;
    boxSelectMode = false;
    document.getElementById('deleteModeBtn').classList.remove('mode-active');
    document.getElementById('boxSelectBtn').classList.remove('mode-active');
    const btn = document.getElementById('linkModeBtn');
    if (linkMode) {
        btn.classList.add('mode-active');
        btn.textContent = '🔗 退出连线';
        document.getElementById('modeHint').innerHTML = '🔗 请依次点击两个节点建立连接';
        firstNodeId = null;
        network.setOptions({ physics: false, interaction: { dragNodes: false } });
    } else {
        btn.classList.remove('mode-active');
        btn.textContent = '🔗 连线';
        document.getElementById('modeHint').innerHTML = '💡 已退出连线模式';
        firstNodeId = null;
        network.setOptions({ physics: false, interaction: { dragNodes: true } });
    }
}

function handleLinkModeClick(params) {
    if (params.nodes.length === 0) return;
    const nodeId = params.nodes[0];
    if (!firstNodeId) {
        firstNodeId = nodeId;
        document.getElementById('modeHint').innerHTML = `🔗 已选起点: ${nodes.get(nodeId).label}，请点击终点`;
        return;
    } else {
        const from = firstNodeId;
        const to = nodeId;
        if (from === to) {
            document.getElementById('modeHint').innerHTML = '⚠️ 不能连接自己';
            firstNodeId = null;
            return;
        }
        const existing = edges.get().find(e => (e.from === from && e.to === to) || (e.from === to && e.to === from));
        if (existing) {
            document.getElementById('modeHint').innerHTML = '⚠️ 已存在连接';
            firstNodeId = null;
            return;
        }
        const newEdge = { from, to, color: { color: '#5a7a9a' }, width: 2, smooth: { type: 'continuous' } };
        edges.add(newEdge);
        const addedEdge = edges.get().find(e => e.from === from && e.to === to);
        pushHistory({ type: 'addEdge', edge: addedEdge });
        document.getElementById('modeHint').innerHTML = `✅ 已连接 ${nodes.get(from).label} ↔ ${nodes.get(to).label}`;
        firstNodeId = null;
    }
}

// =================================================================
// 删除模式
// =================================================================
function toggleDeleteMode() {
    deleteMode = !deleteMode;
    linkMode = false;
    boxSelectMode = false;
    document.getElementById('linkModeBtn').classList.remove('mode-active');
    document.getElementById('boxSelectBtn').classList.remove('mode-active');
    const btn = document.getElementById('deleteModeBtn');
    if (deleteMode) {
        btn.classList.add('mode-active');
        btn.textContent = '🗑️ 退出删除';
        document.getElementById('modeHint').innerHTML = '🗑️ 点击节点或连线即可删除';
        network.setOptions({ physics: false, interaction: { dragNodes: false } });
    } else {
        btn.classList.remove('mode-active');
        btn.textContent = '🗑️ 删除';
        document.getElementById('modeHint').innerHTML = '💡 已退出删除模式';
        network.setOptions({ physics: false, interaction: { dragNodes: true } });
    }
}

function handleDeleteModeClick(params) {
    if (params.nodes.length === 1) {
        const nodeId = params.nodes[0];
        const node = nodes.get(nodeId);
        if (!node) return;
        if (confirm(`确定删除设备 "${node.label}" 及其所有连接吗？`)) {
            const incidentEdges = edges.get().filter(e => e.from === nodeId || e.to === nodeId);
            const action = { type: 'deleteNodes', nodes: [node], edges: incidentEdges };
            nodes.remove(nodeId);
            pushHistory(action);
            document.getElementById('modeHint').innerHTML = `🗑️ 已删除 ${node.label}`;
        }
    } else if (params.edges.length === 1) {
        const edgeId = params.edges[0];
        const edge = edges.get(edgeId);
        if (edge && confirm(`确定删除这条连接吗？`)) {
            const action = { type: 'deleteEdge', edge: edge };
            edges.remove(edgeId);
            pushHistory(action);
            document.getElementById('modeHint').innerHTML = `🗑️ 已删除连接`;
        }
    } else {
        document.getElementById('modeHint').innerHTML = '🗑️ 请点击具体的节点或连线';
    }
}

// =================================================================
// 框选模式
// =================================================================
function toggleBoxSelect() {
    boxSelectMode = !boxSelectMode;
    linkMode = false;
    deleteMode = false;
    document.getElementById('linkModeBtn').classList.remove('mode-active');
    document.getElementById('deleteModeBtn').classList.remove('mode-active');
    const btn = document.getElementById('boxSelectBtn');
    if (boxSelectMode) {
        btn.classList.add('mode-active');
        btn.textContent = '📐 退出框选';
        document.getElementById('modeHint').innerHTML = '📐 在空白处拖拽框选设备，按 Delete 或点击“删除选中”删除';
        network.setOptions({ interaction: { dragNodes: false, dragView: false } });
    } else {
        btn.classList.remove('mode-active');
        btn.textContent = '📐 框选';
        document.getElementById('modeHint').innerHTML = '💡 已退出框选模式';
        network.setOptions({ interaction: { dragNodes: true, dragView: true } });
        selectionBox.style.display = 'none';
        isSelecting = false;
        window._selectedNodes = [];
    }
}

function onMouseDown(e) {
    if (!boxSelectMode) return;
    const target = e.target;
    if (target.closest('.vis-network') && !target.closest('.vis-node')) {
        const container = document.getElementById('mynetwork');
        const rect = container.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        isSelecting = true;
        selectionBox.style.display = 'block';
        selectionBox.style.left = startX + 'px';
        selectionBox.style.top = startY + 'px';
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
    }
}

function onMouseMove(e) {
    if (!isSelecting) return;
    const container = document.getElementById('mynetwork');
    const rect = container.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
}

function onMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;
    const container = document.getElementById('mynetwork');
    const rect = container.getBoundingClientRect();
    const left = parseInt(selectionBox.style.left);
    const top = parseInt(selectionBox.style.top);
    const width = parseInt(selectionBox.style.width);
    const height = parseInt(selectionBox.style.height);
    selectionBox.style.display = 'none';
    if (width < 5 || height < 5) {
        window._selectedNodes = [];
        document.getElementById('modeHint').innerHTML = '📐 框选区域太小，未选中任何设备';
        return;
    }
    const box = { left, top, right: left + width, bottom: top + height };
    const nodePositions = network.getPositions();
    const selectedIds = [];
    for (const [id, pos] of Object.entries(nodePositions)) {
        const canvasPos = network.canvasToDOM({ x: pos.x, y: pos.y });
        if (canvasPos.x >= box.left && canvasPos.x <= box.right &&
            canvasPos.y >= box.top && canvasPos.y <= box.bottom) {
            selectedIds.push(id);
        }
    }
    if (selectedIds.length > 0) {
        selectedIds.forEach(id => {
            nodes.update({ id: id, color: '#ffd93d' });
        });
        window._selectedNodes = selectedIds;
        document.getElementById('modeHint').innerHTML = `📐 已选中 ${selectedIds.length} 个设备，按 Delete 或点击“删除选中”删除`;
    } else {
        window._selectedNodes = [];
        document.getElementById('modeHint').innerHTML = '📐 未选中任何设备';
    }
}

function deleteSelectedNodes() {
    const ids = window._selectedNodes || [];
    if (ids.length === 0) {
        document.getElementById('modeHint').innerHTML = '⚠️ 请先框选设备';
        return;
    }
    if (confirm(`确定删除 ${ids.length} 个设备及其所有连接吗？`)) {
        const removedNodes = ids.map(id => nodes.get(id));
        const removedEdges = [];
        ids.forEach(id => {
            const incident = edges.get().filter(e => e.from === id || e.to === id);
            removedEdges.push(...incident);
        });
        const action = { type: 'deleteNodes', nodes: removedNodes, edges: removedEdges };
        nodes.remove(ids);
        pushHistory(action);
        window._selectedNodes = [];
        resetHighlight();
        document.getElementById('modeHint').innerHTML = `🗑️ 已删除 ${ids.length} 个设备`;
        const allNodes = nodes.get();
        allNodes.forEach(n => {
            if (n.color === '#ffd93d') nodes.update({ id: n.id, color: deviceColors[n.label] || '#4fc3f7' });
        });
    }
}

// =================================================================
// 撤销 / 重做（含重命名支持）
// =================================================================
function pushHistory(action) {
    undoStack.push(action);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
}

function undo() {
    if (undoStack.length === 0) {
        document.getElementById('modeHint').innerHTML = '⚠️ 没有可撤销的操作';
        return;
    }
    const action = undoStack.pop();
    let reverseAction = null;
    if (action.type === 'addNode') {
        const node = action.node;
        const incidentEdges = edges.get().filter(e => e.from === node.id || e.to === node.id);
        reverseAction = { type: 'deleteNodes', nodes: [node], edges: incidentEdges };
        nodes.remove(node.id);
    } else if (action.type === 'addEdge') {
        const edge = action.edge;
        reverseAction = { type: 'deleteEdge', edge: edge };
        edges.remove(edge.id);
    } else if (action.type === 'deleteNodes') {
        const { nodes: removedNodes, edges: removedEdges } = action;
        reverseAction = { type: 'addNodes', nodes: removedNodes, edges: removedEdges };
        const existingIds = new Set(nodes.get().map(n => n.id));
        const nodesToAdd = removedNodes.filter(n => !existingIds.has(n.id));
        const edgesToAdd = removedEdges.filter(e => nodes.get(e.from) && nodes.get(e.to));
        nodes.add(nodesToAdd);
        edges.add(edgesToAdd);
        reverseAction = { type: 'addNodes', nodes: nodesToAdd, edges: edgesToAdd };
    } else if (action.type === 'deleteEdge') {
        const edge = action.edge;
        reverseAction = { type: 'addEdge', edge: edge };
        if (nodes.get(edge.from) && nodes.get(edge.to)) {
            edges.add(edge);
        } else {
            reverseAction = null;
        }
    } else if (action.type === 'renameNode') {
        // 撤销重命名：恢复旧名称
        const { nodeId, oldLabel, newLabel } = action;
        const node = nodes.get(nodeId);
        if (node) {
            nodes.update({ id: nodeId, label: oldLabel });
            reverseAction = { type: 'renameNode', nodeId: nodeId, oldLabel: newLabel, newLabel: oldLabel };
        } else {
            reverseAction = null;
        }
    }
    if (reverseAction) {
        redoStack.push(reverseAction);
        document.getElementById('modeHint').innerHTML = `↩️ 已撤销 (${action.type})`;
    }
    resetHighlight();
}

function redo() {
    if (redoStack.length === 0) {
        document.getElementById('modeHint').innerHTML = '⚠️ 没有可重做的操作';
        return;
    }
    const action = redoStack.pop();
    let undoAction = null;
    if (action.type === 'addNodes') {
        const existingNodeIds = new Set(nodes.get().map(n => n.id));
        const nodesToAdd = action.nodes.filter(n => !existingNodeIds.has(n.id));
        const edgesToAdd = action.edges.filter(e => nodes.get(e.from) && nodes.get(e.to));
        if (nodesToAdd.length === 0 && edgesToAdd.length === 0) {
            document.getElementById('modeHint').innerHTML = '⚠️ 重做失败：节点已存在';
            return;
        }
        nodes.add(nodesToAdd);
        edges.add(edgesToAdd);
        undoAction = { type: 'deleteNodes', nodes: nodesToAdd, edges: edgesToAdd };
    } else if (action.type === 'addEdge') {
        const edge = action.edge;
        const exists = edges.get().some(e => (e.from === edge.from && e.to === edge.to) || (e.from === edge.to && e.to === edge.from));
        if (exists) {
            document.getElementById('modeHint').innerHTML = '⚠️ 重做失败：连接已存在';
            return;
        }
        if (!nodes.get(edge.from) || !nodes.get(edge.to)) {
            document.getElementById('modeHint').innerHTML = '⚠️ 重做失败：节点不存在';
            return;
        }
        edges.add(edge);
        undoAction = { type: 'deleteEdge', edge: edge };
    } else if (action.type === 'deleteNodes') {
        const ids = action.nodes.map(n => n.id);
        const existingIds = ids.filter(id => nodes.get(id));
        if (existingIds.length === 0) {
            document.getElementById('modeHint').innerHTML = '⚠️ 重做失败：节点已被删除';
            return;
        }
        const removedNodes = existingIds.map(id => nodes.get(id));
        const removedEdges = [];
        existingIds.forEach(id => {
            const incident = edges.get().filter(e => e.from === id || e.to === id);
            removedEdges.push(...incident);
        });
        nodes.remove(existingIds);
        undoAction = { type: 'deleteNodes', nodes: removedNodes, edges: removedEdges };
    } else if (action.type === 'deleteEdge') {
        const edge = action.edge;
        const existing = edges.get().find(e => (e.from === edge.from && e.to === edge.to) || (e.from === edge.to && e.to === edge.from));
        if (!existing) {
            document.getElementById('modeHint').innerHTML = '⚠️ 重做失败：连接已被删除';
            return;
        }
        edges.remove(existing.id);
        undoAction = { type: 'deleteEdge', edge: existing };
    } else if (action.type === 'renameNode') {
        // 重做重命名：改为新名称
        const { nodeId, oldLabel, newLabel } = action;
        const node = nodes.get(nodeId);
        if (node) {
            nodes.update({ id: nodeId, label: newLabel });
            undoAction = { type: 'renameNode', nodeId: nodeId, oldLabel: newLabel, newLabel: oldLabel };
        } else {
            document.getElementById('modeHint').innerHTML = '⚠️ 重做失败：节点不存在';
            return;
        }
    }
    if (undoAction) {
        undoStack.push(undoAction);
        document.getElementById('modeHint').innerHTML = `↪️ 已重做`;
    }
    resetHighlight();
}

// =================================================================
// 保存 / 清空
// =================================================================
function saveTopology() {
    const data = {
        nodes: nodes.get().map(n => ({
            id: n.id, label: n.label, color: n.color, size: n.size,
            shape: n.shape, x: n.x, y: n.y, font: n.font
        })),
        edges: edges.get().map(e => ({
            from: e.from, to: e.to, color: e.color, width: e.width, smooth: e.smooth
        }))
    };
    localStorage.setItem('topologyData', JSON.stringify(data));
}

function clearTopology() {
    if (confirm('确定清空所有设备和连接吗？')) {
        const allNodes = nodes.get();
        const allEdges = edges.get();
        if (allNodes.length === 0) return;
        const action = { type: 'deleteNodes', nodes: allNodes, edges: allEdges };
        nodes.clear();
        edges.clear();
        pushHistory(action);
        localStorage.removeItem('topologyData');
        document.getElementById('modeHint').innerHTML = '🔄 已清空';
        resetHighlight();
        const display = document.getElementById('pathDisplay');
        display.innerHTML = '💡 已清空，请添加设备';
        display.style.borderColor = '#00d4ff';
        display.style.color = '#00d4ff';
        window._selectedNodes = [];
    }
}

// =================================================================
// 高亮路径
// =================================================================
function highlightPath(pathNames) {
    resetHighlight();
    const updatedNodes = nodes.get().map(node => {
        if (pathNames.includes(node.id)) {
            return { ...node, color: '#ff6b6b', size: 18, font: { ...node.font, color: '#ff6b6b' } };
        }
        return node;
    });
    nodes.update(updatedNodes);
    const updatedEdges = edges.get().map(edge => {
        const fromIdx = pathNames.indexOf(edge.from);
        const toIdx = pathNames.indexOf(edge.to);
        if (fromIdx !== -1 && toIdx !== -1 && Math.abs(fromIdx - toIdx) === 1) {
            return { ...edge, color: { color: '#ff6b6b' }, width: 4, shadow: true };
        }
        return edge;
    });
    edges.update(updatedEdges);
}

function resetHighlight() {
    const defaultNodes = nodes.get().map(node => ({
        ...node,
        color: deviceColors[node.label] || '#4fc3f7',
        size: 14,
        font: { ...node.font, color: '#ffffff' }
    }));
    nodes.update(defaultNodes);
    const defaultEdges = edges.get().map(edge => ({
        ...edge,
        color: { color: '#5a7a9a' },
        width: 2,
        shadow: false
    }));
    edges.update(defaultEdges);
}

// =================================================================
// 新增：AI 语义解析与生成功能
// =================================================================

/**
 * 解析网络语义：调用后端 AI 接口，解析用户输入的网络需求，
 * 提取设备角色和配置任务，并在浮动面板中展示结果。
 */
async function parseAndShow() {
    const textarea = document.getElementById('promptInput');
    const status = document.getElementById('aiStatus');
    const userText = textarea.value.trim();
    if (!userText) {
        status.innerHTML = '⚠️ 请输入网络需求';
        return;
    }
    status.innerHTML = '⏳ 正在解析网络语义...';
    try {
        const response = await fetch('/api/parse_requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: userText })
        });
        const result = await response.json();
        if (result.error) {
            status.innerHTML = '❌ ' + result.error;
            return;
        }
        showParseResult(result);
        status.innerHTML = '✅ 解析完成，共 ' + result.devices.length + ' 个设备';
    } catch (error) {
        status.innerHTML = '❌ 请求失败: ' + error.message;
        console.error(error);
    }
}

/**
 * 显示解析结果面板
 * @param {Object} data - 包含 devices 和 tech_features 的解析结果
 */
// =================================================================
// 显示解析结果 + 自动生成拓扑图（新增）
// =================================================================
// =================================================================
// 显示解析结果 + 自动生成拓扑图（完整优化版）
// =================================================================
function showParseResult(data) {
    console.log('📦 解析结果数据:', data);

    const panel = document.getElementById('parseResultPanel');
    const content = document.getElementById('parseResultContent');
    let html = '';
    if ((!data.devices || data.devices.length === 0) && data.id && data.role) {
        data.devices = [{
            id: data.id,
            role: data.role,
            tasks: data.tasks || []
        }];
        // 删除顶层字段，避免后续干扰
        delete data.id;
        delete data.role;
        delete data.tasks;
        console.log('🔄 前端修正：已将顶层设备转为 devices 数组');
    }
    // 确保 devices 是数组
    if (!Array.isArray(data.devices)) {
        data.devices = [];
    }
    if (!Array.isArray(data.tech_features)) {
        data.tech_features = [];
    }
    console.log('📦 修正后的数据:', data);
    
    // ... 其余代码（面板渲染和生成拓扑）保持不变 ...
    
    // 技术特性
    if (data.tech_features && data.tech_features.length > 0) {
        html += `<div class="tech-tags">🔹 技术特性: ${data.tech_features.map(t => `<span>${t}</span>`).join('')}</div>`;
    }
    
    // 设备列表
    if (data.devices && data.devices.length > 0) {
        data.devices.forEach(dev => {
            html += `<div class="device-item">`;
            html += `<strong>${dev.id}</strong> <span class="role-tag">${dev.role || '未识别'}</span>`;
            if (dev.tasks && dev.tasks.length > 0) {
                html += `<br><span style="font-size:12px;color:#8899aa;">📋 配置任务: </span>`;
                dev.tasks.forEach(task => {
                    html += `<span class="task-tag">${task}</span>`;
                });
            }
            html += `</div>`;
        });
    } else {
        html = `<div class="empty-hint">未识别到设备，请检查输入描述</div>`;
    }
    content.innerHTML = html;
    panel.style.display = 'block';

    // ============================================================
    // 🔥 自动生成拓扑图
    // ============================================================
    if (data.devices && data.devices.length > 0 && data.devices[0].id !== '未识别') {
        console.log('🎨 准备生成拓扑图，设备数量:', data.devices.length);
        generateTopologyFromParseResult(data);
    } else {
        console.warn('⚠️ 未识别到有效设备，跳过拓扑生成');
    }
}

// ============================================================
// 根据解析结果生成拓扑图（完整优化版）
// ============================================================
function generateTopologyFromParseResult(data) {
    console.log('🔧 执行 generateTopologyFromParseResult，设备数量:', data.devices.length);
    
    network.setOptions({ physics: false });
    nodes.clear();
    edges.clear();
    
    const deviceList = data.devices;
    const nodeCount = deviceList.length;
    if (nodeCount === 0) {
        console.warn('⚠️ 设备列表为空，无法生成拓扑');
        return;
    }
    
    // ===== 角色样式映射（支持关键词匹配）=====
    const roleColorsExact = {
        'ISP': '#ff4444',
        'MGRE_Hub': '#ffaa00',
        'MGRE_Spoke': '#44aaff',
        '普通路由器': '#66cc66',
        '核心交换机': '#ff6432',
        '汇聚交换机': '#ffc832',
        '接入交换机': '#32c864',
        '防火墙': '#aa44ff',
        '服务器': '#aa66cc',
        'Spine': '#ff6432',
        'Leaf': '#44aaff'
    };
    const roleShapesExact = {
        'ISP': 'star',
        'MGRE_Hub': 'box',
        'MGRE_Spoke': 'dot',
        '普通路由器': 'dot',
        '核心交换机': 'star',
        '汇聚交换机': 'box',
        '接入交换机': 'box',
        '防火墙': 'square',
        '服务器': 'square',
        'Spine': 'star',
        'Leaf': 'box'
    };
    const roleLabelsExact = {
        'ISP': '🌐 ISP',
        'MGRE_Hub': '📡 Hub',
        'MGRE_Spoke': '📡 Spoke',
        '普通路由器': 'Router',
        '核心交换机': 'Core',
        '汇聚交换机': 'Agg',
        '接入交换机': 'Access',
        '防火墙': '🔥 FW',
        '服务器': '🖥️ Server',
        'Spine': 'Spine',
        'Leaf': 'Leaf'
    };
    const roleKeywords = [
        { keywords: ['isp'], color: '#ff4444', shape: 'star', label: '🌐 ISP' },
        { keywords: ['hub', '中心'], color: '#ffaa00', shape: 'box', label: '📡 Hub' },
        { keywords: ['spoke', 'branch', '分支'], color: '#44aaff', shape: 'dot', label: '📡 Spoke' },
        { keywords: ['core', '核心', 'spine'], color: '#ff6432', shape: 'star', label: 'Core' },
        { keywords: ['agg', '汇聚', 'leaf'], color: '#ffc832', shape: 'box', label: 'Agg' },
        { keywords: ['access', '接入'], color: '#32c864', shape: 'box', label: 'Access' },
        { keywords: ['fw', 'firewall', '防火墙', 'border'], color: '#aa44ff', shape: 'square', label: '🔥 FW' },
        { keywords: ['server', '服务器'], color: '#aa66cc', shape: 'square', label: '🖥️ Server' }
    ];
    function getRoleStyle(role) {
        if (!role) return { color: '#4fc3f7', shape: 'dot', label: '?' };
        const lowerRole = role.toLowerCase();
        if (roleColorsExact[role]) {
            return { color: roleColorsExact[role], shape: roleShapesExact[role] || 'dot', label: roleLabelsExact[role] || role };
        }
        for (const rule of roleKeywords) {
            if (rule.keywords.some(kw => lowerRole.includes(kw))) {
                return { color: rule.color, shape: rule.shape, label: rule.label };
            }
        }
        return { color: '#4fc3f7', shape: 'dot', label: '?' };
    }
    
    // ===== 添加节点 =====
    const container = document.getElementById('mynetwork');
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const radius = Math.min(Math.max(180, nodeCount * 30), 500);
    
    deviceList.forEach((dev, index) => {
        const style = getRoleStyle(dev.role);
        const angle = (index / nodeCount) * 2 * Math.PI - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        nodes.add({
            id: dev.id,
            label: `${dev.id}\n${style.label}`,
            color: style.color,
            shape: style.shape,
            size: 22,
            font: { size: 12, color: '#ffffff', background: 'rgba(0,0,0,0.4)', strokeWidth: 1, align: 'center' },
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.3)',
            x, y
        });
        console.log(`✅ 已添加节点: ${dev.id} (${dev.role}) -> 颜色: ${style.color}, 形状: ${style.shape}`);
    });
    
    // ===== 智能连线（关键词匹配）=====
    const addedEdges = [];
    function matchRole(dev, keywords) {
        if (!dev || !dev.role) return false;
        const role = dev.role.toLowerCase();
        return keywords.some(kw => role.includes(kw.toLowerCase()));
    }
    
    const isp = deviceList.find(d => matchRole(d, ['isp']));
    const hub = deviceList.find(d => matchRole(d, ['hub', '中心']));
    const spokes = deviceList.filter(d => matchRole(d, ['spoke', 'branch', '分支']));
    const cores = deviceList.filter(d => matchRole(d, ['core', '核心', 'spine']));
    const aggs = deviceList.filter(d => matchRole(d, ['agg', '汇聚', 'leaf']));
    const fws = deviceList.filter(d => matchRole(d, ['fw', 'firewall', '防火墙', 'border']));
    const access = deviceList.filter(d => matchRole(d, ['access', '接入']));
    
    if (isp && hub) {
        edges.add({ from: isp.id, to: hub.id, label: '公网IP', color: { color: '#ff6b6b' }, width: 2, smooth: { type: 'continuous' } });
        addedEdges.push(`${isp.id} → ${hub.id} (公网IP)`);
    }
    if (hub && spokes.length > 0) {
        spokes.forEach(spoke => {
            edges.add({ from: hub.id, to: spoke.id, label: 'MGRE Tunnel', color: { color: '#ffaa00' }, width: 2, dashes: true, smooth: { type: 'continuous' } });
            addedEdges.push(`${hub.id} → ${spoke.id} (MGRE)`);
        });
    }
    if (cores.length > 0 && aggs.length > 0) {
        cores.forEach(core => {
            aggs.forEach(agg => {
                edges.add({ from: core.id, to: agg.id, label: 'OSPF', color: { color: '#4fc3f7' }, width: 2, smooth: { type: 'continuous' } });
                addedEdges.push(`${core.id} → ${agg.id} (OSPF)`);
            });
        });
    }
    if (fws.length > 0 && cores.length > 0) {
        fws.forEach(fw => {
            cores.forEach(core => {
                edges.add({ from: fw.id, to: core.id, label: '安全策略', color: { color: '#aa44ff' }, width: 2, smooth: { type: 'continuous' } });
                addedEdges.push(`${fw.id} → ${core.id} (安全策略)`);
            });
        });
    }
    if (aggs.length > 0 && access.length > 0) {
        aggs.forEach(agg => {
            access.forEach(acc => {
                const accIndex = access.indexOf(acc);
                const aggIndex = aggs.indexOf(agg);
                if (accIndex % aggs.length === aggIndex) {
                    edges.add({ from: agg.id, to: acc.id, label: 'VLAN', color: { color: '#32c864' }, width: 2, smooth: { type: 'continuous' } });
                    addedEdges.push(`${agg.id} → ${acc.id} (VLAN)`);
                }
            });
        });
    }
    
    console.log(`🔗 已添加 ${addedEdges.length} 条连接:`, addedEdges);
    network.setOptions({ physics: false });
    network.fit({ animation: false });
    document.getElementById('modeHint').innerHTML = `✅ 已生成拓扑，共 ${deviceList.length} 个设备`;
    document.getElementById('aiStatus').innerHTML = `✅ 拓扑已生成 (${deviceList.length} 个设备)`;
    saveTopology();
    console.log('🎉 拓扑生成完成！');
}

/**
 * 关闭解析结果面板
 */
function closeParsePanel() {
    document.getElementById('parseResultPanel').style.display = 'none';
}
// =================================================================
// 重置路径选择状态
// =================================================================
function resetPathSelection() {
    if (pathSourceId) {
        // 恢复起点颜色
        const node = nodes.get(pathSourceId);
        if (node) {
            nodes.update({ id: pathSourceId, color: deviceColors[node.label] || '#4fc3f7', size: 14 });
        }
    }
    pathSourceId = null;
    isSelectingPath = false;
}

// =================================================================
// 新增：手动触发最短路径（供外部调用）
// =================================================================
function findShortestPath(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) {
        document.getElementById('modeHint').innerHTML = '⚠️ 请选择两个不同的节点';
        return;
    }
    // 模拟点击事件
    network.on("click")({ nodes: [sourceId] });
    // 延迟后模拟第二次点击
    setTimeout(() => {
        network.on("click")({ nodes: [targetId] });
    }, 300);
}
/**
 * AI 生成拓扑（占位，后续扩展）
 * 当前只显示提示信息
 */
async function generateByAI() {
    const status = document.getElementById('aiStatus');
    status.innerHTML = '⏳ AI生成拓扑功能开发中...';
    // 后续可接入真实AI生成拓扑
    // 例如：调用 /api/generate_topo 接口
    // 暂时模拟延迟后提示
    setTimeout(() => {
        status.innerHTML = '💡 AI生成拓扑功能即将上线，敬请期待！';
    }, 1000);
}

// =================================================================
// 页面加载
// =================================================================
document.addEventListener('DOMContentLoaded', drawNetwork);
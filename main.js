import html2canvas from 'html2canvas';

// Initialize Icons
lucide.createIcons();

// --- State ---
const state = {
  nodes: [],
  connections: [],
  transform: { x: 0, y: 0, scale: 1 },
  isDraggingCanvas: false,
  dragStart: { x: 0, y: 0 },
  activeNodeId: null,
  isDraggingNode: false,
  nodeDragStart: { x: 0, y: 0 },
  isResizingNode: false,
  resizeStart: { w: 0, h: 0, x: 0, y: 0 },
  isConnecting: false,
  connectingStart: null, // { nodeId, portType, x, y }
  connectionJustMade: false,
  mouseX: 0,
  mouseY: 0
};

// --- Workflows ---
const workflowsData = JSON.parse(localStorage.getItem('dev-workflows')) || [{ id: 'default', name: 'My Workflow', data: null }];
let currentWorkflowId = localStorage.getItem('current-workflow-id') || 'default';

// --- History ---
let history = [];
let historyIndex = -1;
let isHistoryOperation = false;
const MAX_HISTORY = 50;

function updateUndoRedoUI() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.disabled = historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
}

function saveState() {
  const workflow = workflowsData.find(w => w.id === currentWorkflowId);
  if (workflow) {
    workflow.data = {
      nodes: state.nodes,
      connections: state.connections,
      transform: state.transform
    };
    localStorage.setItem('dev-workflows', JSON.stringify(workflowsData));
    localStorage.setItem('current-workflow-id', currentWorkflowId);
  }
  
  if (!isHistoryOperation) {
    const snapshot = {
      nodes: JSON.parse(JSON.stringify(state.nodes)),
      connections: JSON.parse(JSON.stringify(state.connections)),
      transform: JSON.parse(JSON.stringify(state.transform))
    };
    
    if (historyIndex >= 0) {
      const currentSnapshot = history[historyIndex];
      // Do not push identical states
      if (JSON.stringify(currentSnapshot) === JSON.stringify(snapshot)) return;
    }
    
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
    
    updateUndoRedoUI();
  }
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    applyHistoryState(history[historyIndex]);
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    applyHistoryState(history[historyIndex]);
  }
}

function applyHistoryState(snapshot) {
  isHistoryOperation = true;
  state.nodes = JSON.parse(JSON.stringify(snapshot.nodes));
  state.connections = JSON.parse(JSON.stringify(snapshot.connections));
  state.transform = JSON.parse(JSON.stringify(snapshot.transform));
  
  nodesContainer.innerHTML = '';
  state.nodes.forEach(n => renderNode(n));
  renderConnections();
  updateTransform();
  
  const workflow = workflowsData.find(w => w.id === currentWorkflowId);
  if (workflow) {
    workflow.data = JSON.parse(JSON.stringify(snapshot));
    localStorage.setItem('dev-workflows', JSON.stringify(workflowsData));
  }
  
  updateUndoRedoUI();
  isHistoryOperation = false;
}

window.addEventListener('mouseup', saveState);
window.addEventListener('keyup', saveState);
window.addEventListener('change', saveState);
// Also save state specifically when clicking on connection delete/node delete buttons
window.addEventListener('click', (e) => {
  if (e.target.closest('button')) setTimeout(saveState, 50);
});

// --- DOM Elements ---
const workspace = document.getElementById('workspace');
const canvasContainer = document.getElementById('canvas-container');
const nodesContainer = document.getElementById('nodes-container');
const connectionsSvg = document.getElementById('connections');
const nodeTemplate = document.getElementById('node-template');
const actionNodeTemplate = document.getElementById('action-node-template');

// --- Helper: Generate ID ---
function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

// --- Canvas Transform ---
function updateTransform() {
  canvasContainer.style.transform = `translate(${state.transform.x}px, ${state.transform.y}px) scale(${state.transform.scale})`;
}

// --- Node Management ---
function addNode(x = null, y = null, width = 250, height = 150, text = "", type = "text") {
  // Determine center if x, y not provided
  if (x === null || y === null) {
    const rect = workspace.getBoundingClientRect();
    x = (rect.width / 2 - state.transform.x) / state.transform.scale - width / 2;
    y = (rect.height / 2 - state.transform.y) / state.transform.scale - height / 2;
  }

  const id = 'node_' + generateId();
  const branchType = type === 'condition' ? 'yes_no' : 'standard';
  const label = "New Step";
  const node = { id, x, y, width, height, text, type, branchType, label };
  state.nodes.push(node);
  renderNode(node);
  return id;
}

function deleteNode(id) {
  // Remove node
  state.nodes = state.nodes.filter(n => n.id !== id);
  const el = document.getElementById(id);
  if (el) el.remove();

  // Remove related connections
  state.connections = state.connections.filter(c => c.fromId !== id && c.toId !== id);
  renderConnections();
}

function copyNode(id) {
  const node = state.nodes.find(n => n.id === id);
  if (node) {
    const newId = addNode(node.x + 20, node.y + 20, node.width, node.height, node.text, node.type);
    const newNode = state.nodes.find(n => n.id === newId);
    newNode.label = node.label || 'New Step';
    newNode.branchType = node.branchType || 'standard';
    
    // Re-render to update the DOM with the copied properties
    const el = document.getElementById(newId);
    if (el) el.remove();
    renderNode(newNode);
  }
}

// --- Rendering ---
function renderNode(node) {
  let template = nodeTemplate;
  if (node.type === 'action') template = actionNodeTemplate;
  
  const clone = template.content.cloneNode(true);
  const nodeEl = clone.querySelector('.workflow-node');
  nodeEl.id = node.id;
  
  updateNodeStyle(nodeEl, node);
  
  const textarea = nodeEl.querySelector('.node-text');
  if (textarea) {
    textarea.value = node.text || '';
    textarea.addEventListener('input', (e) => {
      node.text = e.target.value;
    });
  }
  
  const labelInput = nodeEl.querySelector('.node-label-input');
  if (labelInput) {
    labelInput.value = node.label || '';
    labelInput.addEventListener('input', (e) => {
      node.label = e.target.value;
    });
    // Stop propagation so clicking in it doesn't do unexpected things if we add more handlers
    labelInput.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
  }
  
  const select = nodeEl.querySelector('.branch-select');
  if (select) {
    select.value = node.branchType || 'standard';
    nodeEl.setAttribute('data-branch', node.branchType || 'standard');
    
    select.addEventListener('change', (e) => {
      node.branchType = e.target.value;
      nodeEl.setAttribute('data-branch', node.branchType);
      
      // Remove any outgoing connections from this node when branch type changes
      state.connections = state.connections.filter(c => c.fromId !== node.id);
      renderConnections();
    });
  }

  // Events setup
  setupNodeEvents(nodeEl, node);
  
  nodesContainer.appendChild(nodeEl);
  lucide.createIcons({ root: nodeEl });
}

function updateNodeStyle(el, node) {
  el.style.left = `${node.x}px`;
  el.style.top = `${node.y}px`;
  el.style.width = `${node.width}px`;
  el.style.height = `${node.height}px`;
}

function setupNodeEvents(el, node) {
  // Selection
  el.addEventListener('mousedown', (e) => {
    document.querySelectorAll('.workflow-node').forEach(n => n.classList.remove('selected'));
    el.classList.add('selected');
  });

  // Dragging Node
  const handle = el.querySelector('.node-drag-handle');
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    state.activeNodeId = node.id;
    state.isDraggingNode = true;
    state.nodeDragStart = { x: e.clientX, y: e.clientY };
  });

  // Delete & Copy
  el.querySelector('.node-delete-btn').addEventListener('click', () => deleteNode(node.id));
  el.querySelector('.node-copy-btn').addEventListener('click', () => copyNode(node.id));

  // Resizing Node
  const resizer = el.querySelector('.node-resizer');
  if (resizer) {
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.activeNodeId = node.id;
      state.isResizingNode = true;
      state.resizeStart = { 
        w: node.width, 
        h: node.height, 
        x: e.clientX, 
        y: e.clientY 
      };
    });
  }

  // Connecting Ports
  const ports = el.querySelectorAll('.node-port');
  
  ports.forEach(portEl => {
    const portType = portEl.getAttribute('data-port');
    
    // Mousedown starts a connection
    portEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startConnection(node.id, portType, e);
    });

    // Mouseup completes a connection
    portEl.addEventListener('mouseup', (e) => {
      if (state.isConnecting && state.connectingStart.nodeId !== node.id) {
        state.connectionJustMade = true;
        const fromPortType = state.connectingStart.portType;
        
        // Prevent connecting inputs to inputs, or outputs to outputs
        const isFromOut = fromPortType.startsWith('out');
        const isToIn = portType === 'in';
        
        if (isFromOut && isToIn) {
          addConnection(state.connectingStart.nodeId, node.id, fromPortType, portType);
        } else if (!isFromOut && !isToIn) { // from 'in' to 'out'
          addConnection(node.id, state.connectingStart.nodeId, portType, fromPortType);
        }
      }
    });
  });
}

// --- Connections ---
function addConnection(fromId, toId, fromPort, toPort) {
  // Prevent duplicate connections exactly the same
  const exists = state.connections.find(c => c.fromId === fromId && c.toId === toId && c.fromPort === fromPort);
  if (!exists) {
    state.connections.push({ id: generateId(), fromId, toId, fromPort, toPort });
    renderConnections();
  }
}

function startConnection(nodeId, portType, e) {
  state.isConnecting = true;
  const el = document.getElementById(nodeId);
  const portEl = el.querySelector(`[data-port="${portType}"]`);
  const rect = portEl.getBoundingClientRect();
  
  // Calculate starting point relative to canvas container
  const canvasRect = canvasContainer.getBoundingClientRect();
  const x = (rect.left + rect.width / 2 - canvasRect.left) / state.transform.scale;
  const y = (rect.top + rect.height / 2 - canvasRect.top) / state.transform.scale;
  
  state.connectingStart = { nodeId, portType, x, y };
}

function renderConnections() {
  // Clear existing
  connectionsSvg.innerHTML = '';
  
    // Render established connections
  state.connections.forEach(conn => {
    let fromPos, toPos;

    if (conn.fromId) {
      const fromNode = document.getElementById(conn.fromId);
      if (!fromNode) return;
      const fromPort = fromNode.querySelector(`[data-port="${conn.fromPort}"]`);
      if (!fromPort) return;
      fromPos = getPortCenter(fromPort);
    } else {
      fromPos = { x: conn.fromX, y: conn.fromY };
    }

    if (conn.toId) {
      const toNode = document.getElementById(conn.toId);
      if (!toNode) return;
      const toPort = toNode.querySelector(`[data-port="${conn.toPort}"]`);
      if (!toPort) return;
      toPos = getPortCenter(toPort);
    } else {
      toPos = { x: conn.toX, y: conn.toY };
    }

    drawPath(fromPos.x, fromPos.y, toPos.x, toPos.y, conn.id);
  });
  
  // Render active drawing connection
  if (state.isConnecting) {
    const canvasRect = canvasContainer.getBoundingClientRect();
    const toX = (state.mouseX - canvasRect.left) / state.transform.scale;
    const toY = (state.mouseY - canvasRect.top) / state.transform.scale;
    
    if (state.connectingStart.portType.startsWith('out')) {
      drawPath(state.connectingStart.x, state.connectingStart.y, toX, toY, 'active-drawing', true);
    } else {
      drawPath(toX, toY, state.connectingStart.x, state.connectingStart.y, 'active-drawing', true);
    }
  }
}

function getPortCenter(portEl) {
  const rect = portEl.getBoundingClientRect();
  const canvasRect = canvasContainer.getBoundingClientRect();
  return {
    x: (rect.left + rect.width / 2 - canvasRect.left) / state.transform.scale,
    y: (rect.top + rect.height / 2 - canvasRect.top) / state.transform.scale
  };
}

function getBezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return (u * u * u * p0) + (3 * u * u * t * p1) + (3 * u * t * t * p2) + (t * t * t * p3);
}

function drawPath(x1, y1, x2, y2, id, isDrawing = false) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  
  // Create bezier curve (smarter offset for smoother approach)
  const offset = Math.max(Math.abs(x2 - x1) * 0.5, Math.abs(y2 - y1) * 0.5, 80);
  const d = `M ${x1} ${y1} C ${x1 + offset} ${y1}, ${x2 - offset} ${y2}, ${x2} ${y2}`;
  
  path.setAttribute('d', d);
  path.setAttribute('class', `connection-path ${isDrawing ? 'drawing' : ''}`);
  if (id) path.id = id;
  
  // Calculate exact angle of the curve near the end point (t = 0.95)
  const preX = getBezierPoint(0.95, x1, x1 + offset, x2 - offset, x2);
  const preY = getBezierPoint(0.95, y1, y1, y2, y2);
  const angle = Math.atan2(y2 - preY, x2 - preX) * (180 / Math.PI);
  
  // Draw manual arrowhead, perfectly aligned
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  arrow.setAttribute('points', `${x2},${y2} ${x2 - 12},${y2 - 5} ${x2 - 12},${y2 + 5}`);
  arrow.setAttribute('class', `connection-arrow ${isDrawing ? 'drawing' : ''}`);
  arrow.setAttribute('transform', `rotate(${angle}, ${x2}, ${y2})`);
  
  if (!isDrawing) {
    path.addEventListener('mouseenter', () => {
      path.classList.add('hover');
      arrow.classList.add('hover');
    });
    path.addEventListener('mouseleave', () => {
      path.classList.remove('hover');
      arrow.classList.remove('hover');
    });

    path.addEventListener('click', () => {
      if (confirm('Delete this connection?')) {
        state.connections = state.connections.filter(c => c.id !== id);
        renderConnections();
      }
    });
  }
  
  connectionsSvg.appendChild(path);
  connectionsSvg.appendChild(arrow);
}

// --- Global Event Listeners ---
workspace.addEventListener('mousedown', (e) => {
  // If clicking on workspace (not node)
  if (e.target === workspace || e.target === canvasContainer || e.target.id === 'canvas' || e.target.id === 'connections') {
    e.preventDefault();
    state.isDraggingCanvas = true;
    state.dragStart = { x: e.clientX - state.transform.x, y: e.clientY - state.transform.y };
    // Deselect all
    document.querySelectorAll('.workflow-node').forEach(n => n.classList.remove('selected'));
  }
});

window.addEventListener('mousemove', (e) => {
  state.mouseX = e.clientX;
  state.mouseY = e.clientY;

  if (state.isDraggingCanvas) {
    state.transform.x = e.clientX - state.dragStart.x;
    state.transform.y = e.clientY - state.dragStart.y;
    updateTransform();
    if (state.connections.length > 0) renderConnections(); // Update lines if they use absolute screen space
  }
  
  if (state.isDraggingNode && state.activeNodeId) {
    const node = state.nodes.find(n => n.id === state.activeNodeId);
    if (node) {
      const dx = (e.clientX - state.nodeDragStart.x) / state.transform.scale;
      const dy = (e.clientY - state.nodeDragStart.y) / state.transform.scale;
      node.x += dx;
      node.y += dy;
      state.nodeDragStart = { x: e.clientX, y: e.clientY };
      
      const el = document.getElementById(node.id);
      updateNodeStyle(el, node);
      renderConnections();
    }
  }

  if (state.isResizingNode && state.activeNodeId) {
    const node = state.nodes.find(n => n.id === state.activeNodeId);
    if (node) {
      const dx = (e.clientX - state.resizeStart.x) / state.transform.scale;
      const dy = (e.clientY - state.resizeStart.y) / state.transform.scale;
      node.width = Math.max(150, state.resizeStart.w + dx);
      node.height = Math.max(100, state.resizeStart.h + dy);
      
      const el = document.getElementById(node.id);
      updateNodeStyle(el, node);
      renderConnections();
    }
  }

  if (state.isConnecting) {
    renderConnections();
  }
});

window.addEventListener('mouseup', (e) => {
  state.isDraggingCanvas = false;
  state.isDraggingNode = false;
  state.isResizingNode = false;
  
  if (state.isConnecting) {
    if (!state.connectionJustMade) {
      // Dangling connection dropped on empty space
      const canvasRect = canvasContainer.getBoundingClientRect();
      const toX = (e.clientX - canvasRect.left) / state.transform.scale;
      const toY = (e.clientY - canvasRect.top) / state.transform.scale;
      
      if (state.connectingStart.portType === 'in') {
        state.connections.push({ id: generateId(), fromId: null, toId: state.connectingStart.nodeId, toPort: 'in', fromX: toX, fromY: toY });
      } else {
        state.connections.push({ id: generateId(), fromId: state.connectingStart.nodeId, toId: null, fromPort: state.connectingStart.portType, toX: toX, toY: toY });
      }
    }
    state.isConnecting = false;
    state.connectionJustMade = false;
    renderConnections();
  }
});

workspace.addEventListener('wheel', (e) => {
  e.preventDefault();
  
  if (e.ctrlKey) {
    // Zoom
    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    const newScale = Math.min(Math.max(0.2, state.transform.scale + delta), 3);
    
    // Zoom towards mouse position
    const rect = workspace.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    state.transform.x = x - (x - state.transform.x) * (newScale / state.transform.scale);
    state.transform.y = y - (y - state.transform.y) * (newScale / state.transform.scale);
    state.transform.scale = newScale;
  } else {
    // Pan
    state.transform.x -= e.deltaX;
    state.transform.y -= e.deltaY;
    if (state.connections.length > 0) renderConnections();
  }
  
  updateTransform();
  saveState();
}, { passive: false });

// --- Toolbar Actions ---
document.getElementById('add-node-btn').addEventListener('click', () => addNode());
document.getElementById('add-action-btn').addEventListener('click', () => addNode(null, null, 200, 60, "", "action"));

document.getElementById('zoom-in-btn').addEventListener('click', () => {
  state.transform.scale = Math.min(state.transform.scale + 0.2, 3);
  updateTransform();
});

document.getElementById('zoom-out-btn').addEventListener('click', () => {
  state.transform.scale = Math.max(state.transform.scale - 0.2, 0.2);
  updateTransform();
});

document.getElementById('reset-view-btn').addEventListener('click', () => {
  state.transform = { x: 0, y: 0, scale: 1 };
  updateTransform();
  renderConnections();
});

document.getElementById('clear-btn').addEventListener('click', () => {
  if (confirm('Are you sure you want to clear the entire workflow?')) {
    state.nodes = [];
    state.connections = [];
    nodesContainer.innerHTML = '';
    connectionsSvg.innerHTML = '';
    state.transform = { x: 0, y: 0, scale: 1 };
    updateTransform();
  }
});

document.getElementById('download-btn').addEventListener('click', async () => {
  const originalTransform = canvasContainer.style.transform;
  // Briefly reset transform to ensure clean capture
  canvasContainer.style.transform = 'none';
  
  // For download, we might want to temporarily hide the background pattern
  const oldBg = document.body.style.backgroundImage;
  document.body.style.backgroundImage = 'none';
  
  // Deselect node to hide glow
  document.querySelectorAll('.workflow-node').forEach(n => n.classList.remove('selected'));
  
  const exportOverlays = [];
  
  // Hide empty headers and replace active inputs with spans to prevent html2canvas clipping
  document.querySelectorAll('.node-header').forEach(header => {
    const labelInput = header.querySelector('.node-label-input');
    if (labelInput) {
      if (labelInput.value.trim() === '') {
        header.setAttribute('data-export-hidden', 'true');
        header.style.display = 'none';
      } else {
        const span = document.createElement('span');
        span.textContent = labelInput.value;
        const computed = window.getComputedStyle(labelInput);
        span.style.cssText = `
          flex: ${computed.flex};
          color: ${computed.color};
          font-weight: ${computed.fontWeight};
          font-size: ${computed.fontSize};
          font-family: ${computed.fontFamily};
          margin: ${computed.margin};
          padding: ${computed.padding};
          white-space: nowrap;
          overflow: hidden;
          display: inline-block;
          text-overflow: clip;
        `;
        labelInput.style.display = 'none';
        labelInput.parentNode.insertBefore(span, labelInput);
        exportOverlays.push({ overlay: span, original: labelInput });
      }
    }
  });

  // Also replace textareas to guarantee perfect rendering
  document.querySelectorAll('.node-text').forEach(textarea => {
    const div = document.createElement('div');
    div.textContent = textarea.value;
    const computed = window.getComputedStyle(textarea);
    div.style.cssText = `
      width: ${computed.width};
      height: ${computed.height};
      color: ${computed.color};
      font-size: ${computed.fontSize};
      font-family: ${computed.fontFamily};
      line-height: ${computed.lineHeight};
      padding: ${computed.padding};
      margin: ${computed.margin};
      box-sizing: ${computed.boxSizing};
      white-space: pre-wrap;
      word-break: break-word;
      overflow: hidden;
    `;
    textarea.style.display = 'none';
    textarea.style.display = 'none';
    textarea.parentNode.insertBefore(div, textarea);
    exportOverlays.push({ overlay: div, original: textarea });
  });

  // Calculate bounding box to capture entire workflow
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (state.nodes.length > 0) {
    state.nodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
    });
  } else {
    minX = 0; minY = 0; maxX = 500; maxY = 500;
  }

  const padding = 100;
  const contentWidth = maxX - minX + (padding * 2);
  const contentHeight = maxY - minY + (padding * 2);

  const originalWidth = canvasContainer.style.width;
  const originalHeight = canvasContainer.style.height;

  canvasContainer.style.width = `${contentWidth}px`;
  canvasContainer.style.height = `${contentHeight}px`;

  // Backup positions and transform
  const originalPositions = state.nodes.map(n => ({ id: n.id, x: n.x, y: n.y }));
  const originalTransformState = { ...state.transform };
  const originalConnections = JSON.parse(JSON.stringify(state.connections));
  
  // Set transform state to 1 for accurate connection rendering
  state.transform = { x: 0, y: 0, scale: 1 };

  // Shift nodes
  state.nodes.forEach(n => {
    n.x = n.x - minX + padding;
    n.y = n.y - minY + padding;
    const el = document.getElementById(n.id);
    if (el) {
      el.style.left = `${n.x}px`;
      el.style.top = `${n.y}px`;
    }
  });

  // Shift dangling connections
  state.connections.forEach(conn => {
    if (!conn.fromId && conn.fromX !== undefined) {
      conn.fromX = conn.fromX - minX + padding;
      conn.fromY = conn.fromY - minY + padding;
    }
    if (!conn.toId && conn.toX !== undefined) {
      conn.toX = conn.toX - minX + padding;
      conn.toY = conn.toY - minY + padding;
    }
  });

  renderConnections();
  
  try {
    const canvas = await html2canvas(canvasContainer, {
      backgroundColor: '#0f172a',
      logging: false,
      useCORS: true
    });
    
    const link = document.createElement('a');
    link.download = 'workflow-diagram.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('Error generating image', err);
    alert('Failed to generate image. See console for details.');
  } finally {
    // Restore empty headers
    document.querySelectorAll('.node-header[data-export-hidden="true"]').forEach(header => {
      header.removeAttribute('data-export-hidden');
      header.style.display = '';
    });
    // Restore text inputs/areas
    exportOverlays.forEach(item => {
      item.overlay.remove();
      item.original.style.display = '';
    });
    
    // Restore dimensions and positions
    canvasContainer.style.width = originalWidth;
    canvasContainer.style.height = originalHeight;
    canvasContainer.style.transform = originalTransform;
    document.body.style.backgroundImage = oldBg;
    
    state.transform = originalTransformState;
    state.connections = originalConnections;
    
    originalPositions.forEach(pos => {
      const node = state.nodes.find(n => n.id === pos.id);
      if (node) {
        node.x = pos.x;
        node.y = pos.y;
        const el = document.getElementById(node.id);
        if (el) {
          el.style.left = `${node.x}px`;
          el.style.top = `${node.y}px`;
        }
      }
    });
    renderConnections();
  }
});

// --- Workflow Management ---
function renderWorkflowDropdown() {
  const select = document.getElementById('workflow-select');
  select.innerHTML = '';
  workflowsData.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.name;
    if (w.id === currentWorkflowId) opt.selected = true;
    select.appendChild(opt);
  });
}

function loadWorkflow(id) {
  currentWorkflowId = id;
  const workflow = workflowsData.find(w => w.id === id);
  
  history = [];
  historyIndex = -1;
  isHistoryOperation = false;
  updateUndoRedoUI();
  
  if (workflow && workflow.data) {
    state.nodes = JSON.parse(JSON.stringify(workflow.data.nodes || []));
    state.connections = JSON.parse(JSON.stringify(workflow.data.connections || []));
    state.transform = JSON.parse(JSON.stringify(workflow.data.transform || { x: 0, y: 0, scale: 1 }));
  } else {
    // Empty state
    state.nodes = [];
    state.connections = [];
    state.transform = { x: 0, y: 0, scale: 1 };
    addNode(100, 100, 250, 150, "Start Workflow");
    if (workflow) saveState();
  }
  
  nodesContainer.innerHTML = '';
  state.nodes.forEach(n => renderNode(n));
  renderConnections();
  updateTransform();
  localStorage.setItem('current-workflow-id', currentWorkflowId);
}

document.getElementById('workflow-select').addEventListener('change', (e) => {
  loadWorkflow(e.target.value);
});

document.getElementById('new-workflow-btn').addEventListener('click', () => {
  const name = prompt('Enter workflow name:');
  if (name) {
    const newId = 'wf_' + generateId();
    workflowsData.push({ id: newId, name, data: null });
    renderWorkflowDropdown();
    loadWorkflow(newId);
  }
});

document.getElementById('rename-workflow-btn').addEventListener('click', () => {
  const workflow = workflowsData.find(w => w.id === currentWorkflowId);
  const name = prompt('Rename workflow:', workflow.name);
  if (name) {
    workflow.name = name;
    renderWorkflowDropdown();
    saveState();
  }
});

document.getElementById('delete-workflow-btn').addEventListener('click', () => {
  if (workflowsData.length <= 1) {
    alert('Cannot delete the last workflow.');
    return;
  }
  if (confirm('Are you sure you want to delete this workflow?')) {
    const idx = workflowsData.findIndex(w => w.id === currentWorkflowId);
    workflowsData.splice(idx, 1);
    currentWorkflowId = workflowsData[0].id;
    renderWorkflowDropdown();
    loadWorkflow(currentWorkflowId);
    saveState();
  }
});

// --- Init ---
if (!workflowsData.find(w => w.id === currentWorkflowId)) {
  currentWorkflowId = workflowsData[0].id;
}
renderWorkflowDropdown();
loadWorkflow(currentWorkflowId);

// --- Undo / Redo Listeners ---
document.getElementById('undo-btn').addEventListener('click', undo);
document.getElementById('redo-btn').addEventListener('click', redo);

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') {
      if (e.shiftKey) redo();
      else undo();
      e.preventDefault();
    } else if (e.key === 'y') {
      redo();
      e.preventDefault();
    }
  }
});

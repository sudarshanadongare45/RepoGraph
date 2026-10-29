const graphContainer = document.getElementById('graph-container');
const form = document.getElementById('load-form');
const input = document.getElementById('repo-input');
const btn = document.getElementById('load-btn');
const statusMsg = document.getElementById('status-message');
const placeholder = document.querySelector('.placeholder-text');

let currentRepoPath = null;
let graphData = { nodes: [], links: [] };

// D3 Setup
let width = graphContainer.clientWidth;
let height = graphContainer.clientHeight;

window.addEventListener('resize', () => {
    width = graphContainer.clientWidth;
    height = graphContainer.clientHeight;
});

const svg = d3.select("#graph-container")
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%");

const g = svg.append("g");

const zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on("zoom", (event) => {
        g.attr("transform", event.transform);
    });

svg.call(zoom);

let link = g.append("g").attr("class", "links").selectAll(".link");
let node = g.append("g").attr("class", "nodes").selectAll(".node");

const colorScale = {
    "repo": "var(--color-repo)",
    "branch": "var(--color-branch)",
    "folder": "var(--color-folder)",
    "file": "var(--color-file)",
    "special": "var(--color-special)"
};

const importantFiles = ['readme.md', 'index.js', 'main.py', 'package.json', 'requirements.txt'];

function isSpecialFile(name) {
    return importantFiles.includes(name.toLowerCase());
}

function getRadius(d) {
    if (d.type === 'repo') return 20;
    if (d.type === 'branch') return 15;
    if (d.type === 'folder') return Math.min(12 + Math.log2(d.file_count || 1) * 2, 25);
    return 8;
}

function getNodeColor(d) {
    if (d.type === 'file' && isSpecialFile(d.name)) return colorScale['special'];
    return colorScale[d.type] || colorScale['file'];
}

function updateGraph() {
    // 1. Build a parent-child map target -> source
    const parentMap = {};
    graphData.links.forEach(l => {
        const sourceId = (typeof l.source === 'object') ? l.source.id : l.source;
        const targetId = (typeof l.target === 'object') ? l.target.id : l.target;
        parentMap[targetId] = sourceId;
    });

    // 2. Build the hierarchy using d3.stratify
    const stratify = d3.stratify()
        .id(d => d.id)
        .parentId(d => {
            if (d.id === 'repo-root') return null;
            return parentMap[d.id] || null;
        });

    let root;
    try {
        root = stratify(graphData.nodes);
    } catch (err) {
        console.error("D3 Stratify error: ", err);
        return;
    }

    // 3. Compute horizontal tree layout
    // Generous nodeSize [vertical_spacing, horizontal_spacing] to prevent overlap
    const treeLayout = d3.tree().nodeSize([45, 260]);
    treeLayout(root);

    // 4. Update coordinates in graphData.nodes
    const nodeCoords = {};
    root.descendants().forEach(d => {
        nodeCoords[d.id] = { x: d.x, y: d.y };
    });

    graphData.nodes.forEach(n => {
        if (nodeCoords[n.id]) {
            n.x = nodeCoords[n.id].x;
            n.y = nodeCoords[n.id].y;
        }
    });

    // Ensure links have full node objects with updated coordinates
    const nodesById = {};
    graphData.nodes.forEach(n => {
        nodesById[n.id] = n;
    });

    graphData.links.forEach(l => {
        const sourceId = (typeof l.source === 'object') ? l.source.id : l.source;
        const targetId = (typeof l.target === 'object') ? l.target.id : l.target;
        l.source = nodesById[sourceId] || l.source;
        l.target = nodesById[targetId] || l.target;
    });

    // 5. Update Links using paths with curved line generator d3.linkHorizontal
    link = link.data(graphData.links, d => {
        const sourceId = (typeof d.source === 'object') ? d.source.id : d.source;
        const targetId = (typeof d.target === 'object') ? d.target.id : d.target;
        return sourceId + "-" + targetId;
    });
    link.exit().remove();

    const linkGenerator = d3.linkHorizontal()
        .x(d => d.y)
        .y(d => d.x);

    let linkEnter = link.enter().append("path")
        .attr("class", "link")
        .attr("d", d => {
            const parentId = parentMap[d.target.id];
            const parent = nodesById[parentId] || d.source;
            return linkGenerator({
                source: { x: parent.x, y: parent.y },
                target: { x: parent.x, y: parent.y }
            });
        });
    link = linkEnter.merge(link);

    // Transition links to their new positions
    link.transition().duration(500)
        .attr("d", d => {
            return linkGenerator({
                source: { x: d.source.x, y: d.source.y },
                target: { x: d.target.x, y: d.target.y }
            });
        });

    // 6. Update Nodes
    node = node.data(graphData.nodes, d => d.id);
    node.exit().remove();
    
    let nodeEnter = node.enter().append("g")
        .attr("class", "node")
        .attr("transform", d => {
            const parentId = parentMap[d.id];
            const parent = nodesById[parentId];
            if (parent) {
                return `translate(${parent.y},${parent.x})`;
            }
            return `translate(${d.y},${d.x})`;
        })
        .on("click", handleNodeClick);

    nodeEnter.append("circle")
        .attr("r", d => getRadius(d))
        .attr("fill", d => getNodeColor(d));

    nodeEnter.append("text")
        .attr("dx", d => getRadius(d) + 5)
        .attr("dy", ".35em")
        .text(d => {
            if (d.type === 'folder' && d.file_count !== undefined) {
                return `${d.name} (${d.file_count})`;
            }
            return d.name;
        });

    node = nodeEnter.merge(node);
    
    // Transition nodes to their new coordinates
    node.transition().duration(500)
        .attr("transform", d => `translate(${d.y},${d.x})`);
}

async function handleNodeClick(event, d) {
    if (d.type === 'file') {
        openFileViewer(d.id, d.name);
        return;
    }
    if (d.type !== 'folder') return;
    if (d.expanded) return; // Already expanded

    d.expanded = true;
    
    // Add loading indicator to node visually if needed
    d3.select(this).select("circle").attr("stroke", "var(--accent)").attr("stroke-width", "3px");

    try {
        const response = await fetch('/api/expand', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo_path: currentRepoPath, folder_path: d.id })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error(data.error);
            d.expanded = false;
            return;
        }

        const newNodes = [];
        const newLinks = [];

        data.contents.forEach(child => {
            // Assign type based on folder/file mapping from git tree
            child.type = child.type === 'tree' ? 'folder' : 'file';
            
            // Check if node already exists
            if (!graphData.nodes.find(n => n.id === child.id)) {
                newNodes.push(child);
            }
            
            newLinks.push({
                source: d.id,
                target: child.id
            });
        });

        graphData.nodes.push(...newNodes);
        graphData.links.push(...newLinks);
        
        // Remove loading state
        d3.select(this).select("circle").attr("stroke", "#fff").attr("stroke-width", "1.5px");
        
        updateGraph();

    } catch (err) {
        console.error(err);
        d.expanded = false;
    }
}

async function openFileViewer(filePath, fileName) {
    const modal = document.getElementById('file-viewer-modal');
    const modalTitle = document.getElementById('modal-file-name');
    const modalContent = document.getElementById('modal-file-content');
    
    modalTitle.textContent = fileName;
    modalContent.textContent = "Loading file content...";
    modal.classList.remove('hidden');
    
    try {
        const response = await fetch('/api/file_content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                repo_path: currentRepoPath,
                file_path: filePath
            })
        });
        
        const data = await response.json();
        
        if (!response.ok || data.error) {
            throw new Error(data.error || "Failed to load file contents");
        }
        
        modalContent.textContent = data.content;
    } catch (err) {
        modalContent.textContent = `Error: ${err.message}`;
    }
}

// Modal Close logic
document.getElementById('close-modal-btn').addEventListener('click', () => {
    document.getElementById('file-viewer-modal').classList.add('hidden');
});

document.getElementById('file-viewer-modal').addEventListener('click', (e) => {
    if (e.target.id === 'file-viewer-modal') {
        document.getElementById('file-viewer-modal').classList.add('hidden');
    }
});

// Floating Zoom Controls
document.getElementById('zoom-in').addEventListener('click', () => {
    svg.transition().duration(300).call(zoom.scaleBy, 1.3);
});

document.getElementById('zoom-out').addEventListener('click', () => {
    svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.3);
});

document.getElementById('zoom-reset').addEventListener('click', () => {
    svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity.translate(100, height / 2).scale(1));
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const repoInput = input.value.trim();
    if (!repoInput) return;

    btn.disabled = true;
    input.disabled = true;
    statusMsg.textContent = "Loading repository... (cloning may take a moment for URLs)";
    statusMsg.className = "";
    placeholder.style.display = 'none';

    try {
        const response = await fetch('/api/load_repo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo: repoInput })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to load repository");
        }

        currentRepoPath = data.repo_path;
        
        // Reset graph
        graphData = { nodes: [], links: [] };
        
        // Build initial graph
        const repoNode = { id: 'repo-root', name: data.repo_name, type: 'repo' };
        const branchNode = { id: 'branch-node', name: data.branch, type: 'branch' };
        
        graphData.nodes.push(repoNode, branchNode);
        graphData.links.push({ source: repoNode.id, target: branchNode.id });

        data.contents.forEach(item => {
            item.type = item.type === 'tree' ? 'folder' : 'file';
            graphData.nodes.push(item);
            graphData.links.push({ source: branchNode.id, target: item.id });
        });

        // Center view on the left side to allow horizontal expansion to the right
        svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity.translate(100, height/2).scale(1));
        
        updateGraph();
        statusMsg.textContent = "Repository loaded successfully.";

    } catch (err) {
        statusMsg.textContent = err.message;
        statusMsg.className = "error";
    } finally {
        btn.disabled = false;
        input.disabled = false;
    }
});

// AI Chat Logic
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const chatPanel = document.getElementById('chat-panel');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatHistory = document.getElementById('chat-history');

let chatHistoryData = [];

function toggleChat() {
    chatPanel.classList.toggle('hidden');
}

chatToggleBtn.addEventListener('click', toggleChat);
closeChatBtn.addEventListener('click', toggleChat);

function appendMessage(role, content) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message');
    msgDiv.classList.add(role === 'user' ? 'user-message' : 'assistant-message');
    
    // Parse basic markdown or simply display text with newlines
    msgDiv.textContent = content; 
    
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    
    if (role !== 'error') {
        chatHistoryData.push({ role, content });
    }
}

// Enable chat input only when repo is loaded
const originalFetch = window.fetch;
function updateChatInputState() {
    if (currentRepoPath) {
        chatInput.disabled = false;
        chatSendBtn.disabled = false;
    } else {
        chatInput.disabled = true;
        chatSendBtn.disabled = true;
    }
}

// Intercept when repo is loaded to enable chat
const observer = new MutationObserver((mutations) => {
    updateChatInputState();
});
observer.observe(statusMsg, { childList: true, characterData: true, subtree: true });

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (!message || !currentRepoPath) return;

    appendMessage('user', message);
    chatInput.value = '';
    chatInput.disabled = true;
    chatSendBtn.disabled = true;
    
    const loadingMsgId = 'msg-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.id = loadingMsgId;
    loadingDiv.className = 'message assistant-message';
    loadingDiv.textContent = 'Thinking...';
    chatHistory.appendChild(loadingDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                repo_path: currentRepoPath,
                message: message,
                history: chatHistoryData.slice(0, -1) // Excluding the message just added
            })
        });

        const data = await response.json();
        
        // Remove loading message
        document.getElementById(loadingMsgId).remove();

        if (!response.ok || data.error) {
            throw new Error(data.error || "Failed to get response");
        }

        appendMessage('model', data.response);

    } catch (err) {
        document.getElementById(loadingMsgId).remove();
        
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message error-message';
        msgDiv.textContent = err.message;
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    } finally {
        chatInput.disabled = false;
        chatSendBtn.disabled = false;
        chatInput.focus();
    }
});

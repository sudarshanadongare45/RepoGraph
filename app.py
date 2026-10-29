from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import git_utils

app = Flask(__name__, static_folder='static')
CORS(app)

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/api/load_repo', methods=['POST'])
def load_repo():
    data = request.get_json()
    repo_input = data.get('repo')
    
    if not repo_input:
        return jsonify({"error": "No repository provided"}), 400
        
    try:
        if git_utils.is_github_url(repo_input):
            repo_path = git_utils.clone_repo(repo_input)
            repo_name = repo_input.strip('/').split('/')[-1]
            if repo_name.endswith('.git'):
                repo_name = repo_name[:-4]
        else:
            repo_path = repo_input
            repo_name = os.path.basename(os.path.abspath(repo_path))
            
            if not os.path.exists(repo_path) or not os.path.exists(os.path.join(repo_path, '.git')):
                return jsonify({"error": "Invalid local repository path"}), 400

        branch = git_utils.get_current_branch(repo_path)
        contents = git_utils.get_tree_contents(repo_path, "")
        
        # Sort contents: folders first, then files
        contents.sort(key=lambda x: (x['type'] != 'tree', x['name'].lower()))
        
        # Limit initial nodes to avoid clutter
        if len(contents) > 20:
            contents = contents[:20]
            
        return jsonify({
            "repo_name": repo_name,
            "repo_path": repo_path, # keep track of local path for subsequent calls
            "branch": branch,
            "contents": contents
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/expand', methods=['POST'])
def expand_folder():
    data = request.get_json()
    repo_path = data.get('repo_path')
    folder_path = data.get('folder_path')
    
    if not repo_path or folder_path is None:
        return jsonify({"error": "Missing parameters"}), 400
        
    try:
        contents = git_utils.get_tree_contents(repo_path, folder_path)
        contents.sort(key=lambda x: (x['type'] != 'tree', x['name'].lower()))
        
        # Limit to 30 files per folder
        if len(contents) > 30:
            contents = contents[:30]
            
        return jsonify({
            "contents": contents
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/file_content', methods=['POST'])
def get_file_content():
    data = request.get_json()
    repo_path = data.get('repo_path')
    file_path = data.get('file_path')
    
    if not repo_path or not file_path:
        return jsonify({"error": "Missing parameters"}), 400
        
    try:
        content = git_utils.get_file_content(repo_path, file_path)
        if content is None:
            return jsonify({"error": "File not found or is a binary file"}), 404
        return jsonify({"content": content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)


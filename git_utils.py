import subprocess
import os
import shutil
import tempfile
import re

CACHE_DIR = os.path.join(os.path.dirname(__file__), '.repocache')

def is_github_url(url):
    return "github.com" in url

def clone_repo(url):
    if not os.path.exists(CACHE_DIR):
        os.makedirs(CACHE_DIR)
    
    # Create a unique folder name for the repo
    repo_name = url.strip('/').split('/')[-1]
    if repo_name.endswith('.git'):
        repo_name = repo_name[:-4]
        
    target_dir = os.path.join(CACHE_DIR, repo_name)
    
    if os.path.exists(target_dir):
        # Already cloned
        pass
    else:
        # Clone
        try:
            subprocess.run(['git', 'clone', url, target_dir], check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as e:
            raise Exception(f"Failed to clone repository: {e.stderr}")
            
    return target_dir

def get_current_branch(repo_path):
    try:
        res = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd=repo_path, check=True, capture_output=True, text=True)
        return res.stdout.strip()
    except subprocess.CalledProcessError:
        return "main"

def count_files_in_tree(repo_path, tree_hash):
    # Counts all blobs recursively under a tree
    try:
        res = subprocess.run(['git', 'ls-tree', '-r', tree_hash], cwd=repo_path, check=True, capture_output=True, text=True)
        # Count lines containing 'blob'
        return sum(1 for line in res.stdout.splitlines() if 'blob ' in line)
    except subprocess.CalledProcessError:
        return 0

def get_tree_contents(repo_path, path=""):
    """
    Returns the immediate contents of a given path in the repository.
    path is empty string "" for the root.
    """
    try:
        if path == "":
            tree_target = "HEAD"
        else:
            tree_target = f"HEAD:{path}"
            
        res = subprocess.run(['git', 'ls-tree', tree_target], cwd=repo_path, check=True, capture_output=True, text=True)
        lines = res.stdout.splitlines()
        
        contents = []
        for line in lines:
            parts = line.split('\t')
            if len(parts) < 2:
                continue
            metadata = parts[0]
            name = parts[1]
            
            meta_parts = metadata.split(' ')
            obj_type = meta_parts[1]
            obj_hash = meta_parts[2]
            
            node_id = f"{path}/{name}" if path else name
            
            node_info = {
                "id": node_id,
                "name": name,
                "type": obj_type # 'tree' or 'blob'
            }
            
            if obj_type == 'tree':
                file_count = count_files_in_tree(repo_path, obj_hash)
                node_info["file_count"] = file_count
                
            contents.append(node_info)
            
        return contents
    except subprocess.CalledProcessError as e:
        raise Exception(f"Failed to read tree at path '{path}': {e.stderr}")

def get_file_content(repo_path, file_path):
    """
    Returns the content of a specific file in the repository at HEAD.
    """
    try:
        res = subprocess.run(['git', 'show', f"HEAD:{file_path}"], cwd=repo_path, check=True, capture_output=True, text=True, encoding='utf-8', errors='ignore')
        return res.stdout
    except subprocess.CalledProcessError:
        return None

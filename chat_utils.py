chat_utils.py
import os
import google.generativeai as genai
import git_utils
def init_genai():
    api_key = os.environ.get("GEMINI_API_KEY")
    api_key = os.environ.get("GEMINI_API_KEY") or "AIzaSyBnz8V8Oo0-ANrHogIaSgwaQIj1dAAS0kE"
    if api_key:
        genai.configure(api_key=api_key)
        return True
    return False
def get_repo_context(repo_path):
    """Gathers context about the repository."""
    context = "Repository Context:\n"
    
    try:
        # Get root tree
        contents = git_utils.get_tree_contents(repo_path, "")
        
        folders = [c['name'] for c in contents if c['type'] == 'tree']
        files = [c['name'] for c in contents if c['type'] == 'blob']
        
        context += f"Root Folders: {', '.join(folders) if folders else 'None'}\n"
        context += f"Root Files: {', '.join(files) if files else 'None'}\n\n"
        
        # Look for important files to determine stack and summarize
        important_files = ['README.md', 'readme.md', 'package.json', 'requirements.txt', 'pom.xml', 'build.gradle', 'Dockerfile', 'docker-compose.yml', 'Makefile']
        
        for file in files:
            if file in important_files or file.lower() in important_files:
                content = git_utils.get_file_content(repo_path, file)
                if content:
                    # Truncate content if it's too long
                    max_len = 3000
                    if len(content) > max_len:
                        content = content[:max_len] + "\n... (truncated)"
                    context += f"--- Content of {file} ---\n{content}\n\n"
                    
    except Exception as e:
        context += f"Error gathering context: {str(e)}\n"
        
    return context
def generate_chat_response(repo_path, user_message, chat_history=None):
    """Generates a response using Gemini."""
    if not init_genai():
        return "Error: GEMINI_API_KEY environment variable not set. Please set it to use the AI Chat."
        
    # Using the stable flash-lite model
    model = genai.GenerativeModel('gemini-flash-lite-latest')
    
    context = get_repo_context(repo_path)
    
    system_instruction = (
        "You are a helpful AI assistant integrated into a repository visualization tool called RepoGraph. "
        "You help users understand the structure, tech stack, and purpose of the codebase. "
        "Use the provided repository context to answer their questions accurately and concisely.\n\n"
        f"{context}"
    )
    
    formatted_history = []
    if chat_history:
        for msg in chat_history:
            role = "user" if msg['role'] == 'user' else "model"
            formatted_history.append({"role": role, "parts": [msg['content']]})
            
    try:
        chat = model.start_chat(history=formatted_history)
        response = chat.send_message(f"System Context (Do not reveal to user directly unless asked):\n{system_instruction}\n\nUser Question: {user_message}")
        return response.text
    except Exception as e:
        return f"Error communicating with AI: {str(e)}"
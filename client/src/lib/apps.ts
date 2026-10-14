/** CoWrite's applications, in the spirit of an office suite's app launcher. */
export interface AppInfo {
  id: string;
  name: string;
  icon: string;
  color: string;
  to: string;
  blurb: string;
}

export const APPS: AppInfo[] = [
  { id: 'docs', name: 'Docs', icon: '📄', color: '#1f6feb', to: '/new/doc', blurb: 'Rich documents' },
  { id: 'sheets', name: 'Sheets', icon: '📈', color: '#1e8e3e', to: '/new/sheet', blurb: 'Spreadsheets with formulas' },
  { id: 'slides', name: 'Slides', icon: '📊', color: '#e8710a', to: '/new/slides', blurb: 'Presentations' },
  { id: 'forms', name: 'Forms', icon: '📝', color: '#7b1fa2', to: '/new/form', blurb: 'Surveys and quizzes' },
  { id: 'sites', name: 'Sites', icon: '🌐', color: '#3949ab', to: '/new/site', blurb: 'One-page websites' },
  { id: 'keep', name: 'Keep', icon: '💡', color: '#f9ab00', to: '/keep', blurb: 'Quick notes and lists' },
  { id: 'calendar', name: 'Calendar', icon: '📅', color: '#1a73e8', to: '/calendar', blurb: 'Events and reminders' },
  { id: 'tasks', name: 'Tasks', icon: '✅', color: '#188038', to: '/calendar#tasks', blurb: 'Assigned to you' },
  { id: 'meet', name: 'Meet', icon: '🎥', color: '#00897b', to: '/meet', blurb: 'Video meetings' },
  { id: 'chat', name: 'Chat', icon: '💬', color: '#0b8043', to: '/meet?chat=1', blurb: 'Team chat rooms' },
  { id: 'drive', name: 'Drive', icon: '🗂️', color: '#fbbc04', to: '/drive', blurb: 'All your files' },
  { id: 'pics', name: 'Pics', icon: '🖼️', color: '#d93025', to: '/drive?view=images', blurb: 'Your images' },
  { id: 'whiteboard', name: 'Whiteboard', icon: '🧩', color: '#8e24aa', to: '/new/board', blurb: 'Infinite canvas' },
  { id: 'kanban', name: 'Boards', icon: '🗃️', color: '#0277bd', to: '/new/kanban', blurb: 'Kanban projects' },
  { id: 'assistant', name: 'Gemini', icon: '✨', color: '#4285f4', to: '/assistant', blurb: 'Chat with AI' },
  { id: 'notebook', name: 'Notebook', icon: '📚', color: '#5e35b1', to: '/ask', blurb: 'Ask your documents' },
  { id: 'studio', name: 'AI Studio', icon: '🪄', color: '#c2185b', to: '/ai', blurb: 'AI tools' },
  { id: 'templates', name: 'Templates', icon: '🎨', color: '#a8842f', to: '/templates', blurb: '80+ designs' },
];

export const MANAGEMENT = [
  { name: 'Admin & teams', to: '/workspaces' },
  { name: 'Security & encryption', to: '/account#security' },
  { name: 'Work insights', to: '/activity' },
  { name: 'Library & trash', to: '/documents' },
];

/** Template categories double as "solutions". */
export const SOLUTIONS = [
  { name: 'New business', cat: 'Business Plan' },
  { name: 'Small business', cat: 'Company Profile' },
  { name: 'Enterprise', cat: 'Work Report' },
  { name: 'Retail & marketing', cat: 'Marketing & Advertising' },
  { name: 'Manufacturing', cat: 'Research & Analysis' },
  { name: 'Professional services', cat: 'HR & Administration' },
  { name: 'Technology', cat: 'Technology' },
  { name: 'Healthcare', cat: 'Healthcare' },
  { name: 'Education', cat: 'Education & Training' },
  { name: 'Higher education', cat: 'Higher Education' },
  { name: 'Nonprofits', cat: 'Nonprofit' },
  { name: 'Personal & students', cat: 'Personal' },
];

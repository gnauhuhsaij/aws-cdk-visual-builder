import { BookOpen, Plus } from 'lucide-react';
import type { SavedProjectSummary } from '../types';

type SidebarProps = {
  projects: SavedProjectSummary[];
  activeProjectId?: string;
  isDirty: boolean;
  onNewBoard: () => void;
  onProjectSelect: (projectId: string) => void;
  onOpenDefaultProject: () => void;
  isWalkthroughActive: boolean;
};

function formatUpdatedAt(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(value);
}

export function Sidebar({ projects, activeProjectId, isDirty, onNewBoard, onProjectSelect, onOpenDefaultProject, isWalkthroughActive }: SidebarProps) {
  return (
    <aside className="sidebar project-sidebar">
      <div className="project-sidebar-header">
        <div>
          <p className="eyebrow">Projects</p>
          <h2>History</h2>
        </div>
      </div>
      <button type="button" className="history-new-board" onClick={onNewBoard}>
        <Plus size={16} />
        New board
      </button>
      <div className="project-history-list">
        <button type="button" data-tour="default-project" className={`history-project history-default ${isWalkthroughActive ? 'active' : ''}`} onClick={onOpenDefaultProject}>
          <span><BookOpen size={15} /> Default project</span>
          <small>Guided practice</small>
        </button>
        {projects.length === 0 ? (
          <p className="history-empty">Saved boards will appear here.</p>
        ) : (
          projects.map((project) => (
            <button
              type="button"
              key={project.id}
              className={`history-project ${!isWalkthroughActive && project.id === activeProjectId ? 'active' : ''}`}
              onClick={() => onProjectSelect(project.id)}
            >
              <span>{project.name}</span>
              <small>
                {formatUpdatedAt(project.updatedAt)}
                {project.id === activeProjectId && isDirty ? ' • unsaved' : ''}
              </small>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

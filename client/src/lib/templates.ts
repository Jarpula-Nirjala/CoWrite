export interface Template {
  id: string;
  name: string;
  description: string;
  title: string;
  content: string;
}

const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export const TEMPLATES: (() => Template)[] = [
  () => ({ id: 'blank', name: 'Blank document', description: 'Start from an empty page.', title: 'Untitled document', content: '' }),
  () => ({
    id: 'meeting',
    name: 'Meeting notes',
    description: 'Agenda, decisions and action items.',
    title: `Meeting notes – ${today()}`,
    content: `# Meeting notes\n\n**Date:** ${today()}\n**Attendees:** \n\n## Agenda\n1. \n2. \n3. \n\n## Discussion\n- \n\n## Decisions\n- \n\n## Action items\n- [ ] Owner – task – due date\n- [ ] \n`,
  }),
  () => ({
    id: 'proposal',
    name: 'Project proposal',
    description: 'Problem, solution, plan and risks.',
    title: 'Project proposal',
    content: `# Project proposal\n\n## Summary\nOne paragraph describing the project and why it matters.\n\n## Problem\nWhat problem are we solving, and for whom?\n\n## Proposed solution\nHow we will solve it.\n\n## Goals and success metrics\n- \n\n## Timeline\n| Phase | Dates | Outcome |\n| --- | --- | --- |\n| Discovery |  |  |\n| Build |  |  |\n| Launch |  |  |\n\n## Risks and mitigations\n- \n\n## Team\n- \n`,
  }),
  () => ({
    id: 'resume',
    name: 'Resume',
    description: 'A clean, one-page resume layout.',
    title: 'Resume',
    content: `# Your Name\nEmail · Phone · LinkedIn · GitHub\n\n## Summary\nTwo lines about who you are and what you do best.\n\n## Experience\n### Role – Company\n*Month Year – Present*\n- Achievement with a measurable result\n- \n\n## Projects\n### Project name\n- What it does and the technology used\n\n## Education\n### Degree – Institution\n*Year – Year*\n\n## Skills\nLanguages · Frameworks · Tools\n`,
  }),
  () => ({
    id: 'blog',
    name: 'Blog post',
    description: 'Hook, sections and a conclusion.',
    title: 'Blog post draft',
    content: `# A compelling title\n\n*A one-sentence hook that makes people want to read on.*\n\n## Introduction\nSet the scene.\n\n## The main idea\nExplain it with an example.\n\n## Going deeper\n> A quote or key insight.\n\n## Conclusion\nWhat should the reader take away?\n`,
  }),
  () => ({
    id: 'lecture',
    name: 'Lecture notes',
    description: 'Cornell-style notes with a summary.',
    title: `Lecture notes – ${today()}`,
    content: `# Course – Lecture title\n**Date:** ${today()}\n\n## Key concepts\n- \n\n## Notes\n\n\n## Questions\n- \n\n## Summary\nThree sentences that capture the lecture.\n`,
  }),
  () => ({
    id: 'weekly',
    name: 'Weekly report',
    description: 'Progress, plans and blockers.',
    title: `Weekly report – ${today()}`,
    content: `# Weekly report\n**Week of:** ${today()}\n\n## Done this week\n- \n\n## Planned next week\n- \n\n## Blockers\n- \n\n## Metrics\n| Metric | This week | Last week |\n| --- | --- | --- |\n|  |  |  |\n`,
  }),
];

export interface InitialContent {
  tokens: { ch: string; a?: Record<string, unknown> }[];
  settings?: Partial<import('../rich/settings.ts').DocSettings>;
  objects?: { key: string; fields: Record<string, unknown> }[];
}

/** Content to insert when a freshly created document first opens. */
export const pendingContent = {
  set(docId: string, content: InitialContent) {
    try {
      sessionStorage.setItem(`cowrite:init:${docId}`, JSON.stringify(content));
    } catch {
      // ignore
    }
  },
  take(docId: string): InitialContent | null {
    try {
      const v = sessionStorage.getItem(`cowrite:init:${docId}`);
      sessionStorage.removeItem(`cowrite:init:${docId}`);
      return v ? (JSON.parse(v) as InitialContent) : null;
    } catch {
      return null;
    }
  },
};

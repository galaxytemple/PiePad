'use client';
import { deletePassage } from './actions';

export function DeletePassageButton({ id, title }: { id: number; title: string }) {
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!window.confirm(`Delete passage "${title}"?`)) e.preventDefault();
  }
  return (
    <form action={deletePassage.bind(null, id)} onSubmit={onSubmit}>
      <button
        type="submit"
        className="text-xs px-3 py-1.5 border border-danger-200 text-danger-600 dark:border-danger-900/50 dark:text-danger-400 rounded-md hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
        aria-label={`Delete passage "${title}"`}
      >
        삭제
      </button>
    </form>
  );
}

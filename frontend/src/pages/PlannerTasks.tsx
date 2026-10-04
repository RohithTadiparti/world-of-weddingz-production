import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import { EmptyState, Loading } from '../components/ui/Feedback';

type TaskStatus = 'pending' | 'in_progress' | 'done';
interface Client { userId: string; name: string; bride: string | null; groom: string | null; }
interface Task { id: string; title: string; category: string; dueDate: string | null; status: TaskStatus; }
interface Detail { tasks: Task[]; }

const STATUS: Record<TaskStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'pill-neutral' },
  in_progress: { label: 'In progress', className: 'pill-caution' },
  done: { label: 'Completed', className: 'pill-positive' },
};

/** A cross-wedding action queue assembled from the ownership-checked project workspaces. */
export default function PlannerTasks() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const requestedStatus = searchParams.get('status');
  const status: 'all' | TaskStatus | 'overdue' = requestedStatus === 'overdue' || requestedStatus === 'pending' || requestedStatus === 'in_progress' || requestedStatus === 'done' ? requestedStatus : 'all';
  const [wedding, setWedding] = useState('');
  const [query, setQuery] = useState('');
  const clientsQuery = useQuery<{ clients: Client[] }>({
    queryKey: ['planner-clients'], queryFn: async () => (await api.get('/planner/clients')).data, retry: false,
    refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 30_000,
  });
  const clients = clientsQuery.data?.clients ?? [];
  const details = useQueries({
    queries: clients.map((client) => ({
      queryKey: ['planner-client', client.userId],
      queryFn: async () => (await api.get(`/planner/clients/${client.userId}`)).data as Detail,
      retry: false,
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
    })),
  });
  const update = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: TaskStatus }) => api.put(`/planner/tasks/${id}/status`, { status: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner-client'] });
      qc.invalidateQueries({ queryKey: ['planner-clients'] });
      qc.invalidateQueries({ queryKey: ['planner-overview'] });
    },
  });

  const rows = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const needle = query.trim().toLowerCase();
    return details.flatMap((detail, index) => (detail.data?.tasks ?? []).map((task) => ({ task, client: clients[index] })))
      .filter(({ client }) => !wedding || client?.userId === wedding)
      .filter(({ task }) => status === 'all' || (status === 'overdue'
        ? task.status !== 'done' && Boolean(task.dueDate) && new Date(`${task.dueDate}T00:00:00`) < now
        : task.status === status))
      .filter(({ task, client }) => !needle || [task.title, task.category, client?.name, client?.bride, client?.groom]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)))
      .sort((a, b) => (a.task.dueDate ?? '9999-12-31').localeCompare(b.task.dueDate ?? '9999-12-31'));
  }, [clients, details, query, status, wedding]);

  const isLoading = clientsQuery.isPending || details.some((detail) => detail.isPending);
  const isOverdue = (task: Task) => task.status !== 'done' && Boolean(task.dueDate) && new Date(`${task.dueDate}T00:00:00`) < new Date(new Date().setHours(0, 0, 0, 0));
  const nextStatus = (current: TaskStatus): TaskStatus => current === 'pending' ? 'in_progress' : current === 'in_progress' ? 'done' : 'pending';

  return (
    <div className="space-y-5">
      <header><h1 className="page-title">Tasks</h1><p className="page-subtitle">A single action queue for every wedding you manage. Status changes update the shared wedding plan.</p></header>
      <div className="card flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input className="input min-w-0 flex-1 sm:max-w-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search task or wedding" aria-label="Search tasks" />
        <select className="input sm:w-52" value={wedding} onChange={(e) => setWedding(e.target.value)} aria-label="Filter by wedding">
          <option value="">All weddings</option>
          {clients.map((client) => <option key={client.userId} value={client.userId}>{[client.bride, client.groom].filter(Boolean).join(' & ') || client.name}</option>)}
        </select>
        <div className="flex flex-wrap gap-1">
          {(['all', 'overdue', 'pending', 'in_progress', 'done'] as const).map((key) => <Link key={key} to={key === 'all' ? '/tasks' : `/tasks?status=${key}`} aria-current={status === key ? 'page' : undefined} className={status === key ? 'btn btn-sm' : 'btn-outline btn-sm'}>{key === 'all' ? 'All' : key === 'overdue' ? 'Overdue' : STATUS[key].label}</Link>)}
        </div>
      </div>
      {update.isError && <p className="alert-critical">{apiMessage(update.error, 'The task could not be updated.')}</p>}
      {isLoading ? <Loading rows={6} /> : rows.length === 0 ? <EmptyState title="No tasks match these filters">Tasks from your wedding plans will appear here.</EmptyState> : (
        <div className="card overflow-x-auto"><table className="min-w-[44rem] w-full text-left text-sm"><thead><tr><th className="p-3">Task</th><th className="p-3">Wedding</th><th className="p-3">Due</th><th className="p-3">Status</th><th className="p-3"><span className="sr-only">Update task</span></th></tr></thead><tbody className="divide-y divide-gray-200">
          {rows.map(({ task, client }) => <tr key={task.id}><td className="p-3"><p className="font-medium text-gray-900">{task.title}</p><p className="text-xs text-gray-500">{task.category || 'General'}</p></td><td className="p-3"><Link className="text-brand hover:underline" to={`/my-clients/${client?.userId}`}>{[client?.bride, client?.groom].filter(Boolean).join(' & ') || client?.name}</Link></td><td className={`p-3 ${isOverdue(task) ? 'font-medium text-critical-fg' : 'text-gray-600'}`}>{task.dueDate ? formatDate(task.dueDate) : 'No date'}{isOverdue(task) && <span className="block text-xs">Overdue</span>}</td><td className="p-3"><span className={STATUS[task.status].className}>{STATUS[task.status].label}</span></td><td className="p-3 text-right"><button className="btn-outline btn-sm" disabled={update.isPending} onClick={() => update.mutate({ id: task.id, next: nextStatus(task.status) })}>{task.status === 'done' ? 'Reopen' : task.status === 'pending' ? 'Start' : 'Complete'}</button></td></tr>)}
        </tbody></table></div>
      )}
    </div>
  );
}

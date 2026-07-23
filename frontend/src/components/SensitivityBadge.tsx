const STYLES: Record<string, string> = {
  public: 'bg-emerald-900/60 text-emerald-200 border-emerald-500/40',
  internal: 'bg-amber-900/60 text-amber-200 border-amber-500/40',
  confidential: 'bg-rose-900/60 text-rose-200 border-rose-500/40',
}

export default function SensitivityBadge({ value }: { value?: string }) {
  if (!value) return null
  const cls = STYLES[value] ?? 'bg-slate-800 text-slate-300 border-slate-600'
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {value}
    </span>
  )
}

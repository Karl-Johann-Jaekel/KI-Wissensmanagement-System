import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useSkills } from '../../lib/storage'

interface SkillPickerProps {
  onInsert: (content: string) => void
}

/** Popover-Auswahl gespeicherter Prompt-Vorlagen für den Chat-Input. */
export default function SkillPicker({ onInsert }: SkillPickerProps) {
  const skills = useSkills()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Skill einfügen"
        title="Skill (Prompt-Vorlage) einfügen"
        className="rounded-lg p-2 text-muted hover:bg-sunken hover:text-primary-600 dark:hover:text-primary-400"
      >
        <Sparkles className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl border border-edge bg-surface py-1 shadow-lg">
          {skills.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted">
              Noch keine Skills.{' '}
              <Link to="/skills" className="text-primary-600 hover:underline dark:text-primary-400">
                Skills anlegen →
              </Link>
            </div>
          ) : (
            skills.slice(0, 8).map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => {
                  onInsert(skill.content)
                  setOpen(false)
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-sunken"
              >
                <span className="font-medium text-ink">{skill.name}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">{skill.content}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

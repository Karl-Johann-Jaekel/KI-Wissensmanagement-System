import Badge, { type BadgeTone } from './ui/Badge'

const TONES: Record<string, BadgeTone> = {
  public: 'green',
  internal: 'amber',
  confidential: 'rose',
}

export default function SensitivityBadge({ value }: { value?: string }) {
  if (!value) return null
  return <Badge tone={TONES[value] ?? 'neutral'}>{value}</Badge>
}

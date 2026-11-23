import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function LabelBadge({ label, className }: { label: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('max-w-full px-1.5 font-normal text-muted-foreground', className)} title={label}>
      <span className="truncate">{label}</span>
    </Badge>
  );
}

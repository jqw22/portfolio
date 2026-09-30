import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function LabelBadge({ label, className }: { label: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('max-w-[10rem] font-normal text-muted-foreground', className)}>
      <span className="truncate">{label}</span>
    </Badge>
  );
}

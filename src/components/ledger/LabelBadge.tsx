import { Tag } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function LabelBadge({ label, className }: { label: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('max-w-[10rem] gap-1 font-normal text-muted-foreground', className)}>
      <Tag className="size-3" />
      <span className="truncate">{label}</span>
    </Badge>
  );
}

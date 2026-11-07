import { NotificationsService } from './notifications.service';

type StockLevel = { id: string; userId: string; name: string; quantity: number; unit: string | null; minQuantity: number | null };

/** Notifie le salon quand une quantité passe sous (ou atteint) son seuil d'alerte : une seule fois par franchissement. */
export function notifyStockLow(n: NotificationsService | undefined, beforeQuantity: number, after: StockLevel) {
  const min = after.minQuantity;
  if (!n || min == null || after.quantity > min || beforeQuantity <= min) return undefined;
  return n.notify({
    userId: after.userId,
    type: 'stock.low',
    title: after.quantity <= 0 ? 'Rupture de stock' : 'Stock bas',
    body: `${after.name} · il reste ${after.quantity}${after.unit ? ` ${after.unit}` : ''}`,
    data: { stockItemId: after.id },
  });
}

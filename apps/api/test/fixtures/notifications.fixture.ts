import { NotificationEventsService } from "../../src/notifications/notification-events.service";
import { NotificationWriterService } from "../../src/notifications/notification-writer.service";

/**
 * The notification dependency every producer service now takes.
 *
 * Built here once rather than in each spec: the writer holds no state
 * and needs no client of its own — it always writes through the
 * transaction its caller hands it — so a single shared factory is
 * enough, and every integration spec exercises the REAL writer rather
 * than a stub that could hide a broken producer.
 */
export function notificationEvents(): NotificationEventsService {
  return new NotificationEventsService(new NotificationWriterService());
}

import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationWriterService } from "./notification-writer.service";
import { NotificationEventsService } from "./notification-events.service";
import { TraderNotificationsController } from "./trader-notifications.controller";

/**
 * The writer is EXPORTED because 8D.2's business-event producers call
 * it from inside their own transactions. The read service is not: it
 * serves this controller and nothing else.
 */
// PrismaModule is @Global, so PrismaService needs no import here.
@Module({
  controllers: [TraderNotificationsController],
  providers: [NotificationsService, NotificationWriterService, NotificationEventsService],
  exports: [NotificationWriterService, NotificationEventsService],
})
export class NotificationsModule {}

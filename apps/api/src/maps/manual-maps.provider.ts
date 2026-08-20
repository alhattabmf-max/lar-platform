import { Injectable } from "@nestjs/common";
import type {
  Coordinates,
  CoordinateValidationResult,
  MapsProvider,
} from "./maps-provider.interface";

@Injectable()
export class ManualMapsProvider implements MapsProvider {
  validateCoordinates({ latitude, longitude }: Coordinates): CoordinateValidationResult {
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      return { valid: false, reason: "Coordinates must be numeric" };
    }
    if (latitude < -90 || latitude > 90) {
      return { valid: false, reason: "Latitude must be between -90 and 90" };
    }
    if (longitude < -180 || longitude > 180) {
      return { valid: false, reason: "Longitude must be between -180 and 180" };
    }
    return { valid: true };
  }
}

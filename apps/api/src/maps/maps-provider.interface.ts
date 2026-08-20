export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface CoordinateValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Provider Adapter for map/geocoding. Phase 1 ships only
 * ManualMapsProvider (MAP_PROVIDER_MODE=manual): the system accepts
 * human-entered coordinates directly, so registration and location
 * entry are never blocked by a missing map provider (Blueprint §55).
 * A real geocoding provider can be added later behind this same
 * interface.
 */
export interface MapsProvider {
  validateCoordinates(coordinates: Coordinates): CoordinateValidationResult;
}

export const MAPS_PROVIDER = Symbol("MAPS_PROVIDER");

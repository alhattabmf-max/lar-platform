import { ManualMapsProvider } from "./manual-maps.provider";

describe("ManualMapsProvider", () => {
  const provider = new ManualMapsProvider();

  it("accepts a valid Riyadh coordinate pair", () => {
    const result = provider.validateCoordinates({ latitude: 24.7136, longitude: 46.6753 });
    expect(result.valid).toBe(true);
  });

  it("accepts boundary values", () => {
    expect(provider.validateCoordinates({ latitude: 90, longitude: 180 }).valid).toBe(true);
    expect(provider.validateCoordinates({ latitude: -90, longitude: -180 }).valid).toBe(true);
  });

  it("rejects out-of-range latitude", () => {
    const result = provider.validateCoordinates({ latitude: 91, longitude: 0 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Latitude/);
  });

  it("rejects out-of-range longitude", () => {
    const result = provider.validateCoordinates({ latitude: 0, longitude: 181 });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/Longitude/);
  });

  it("rejects non-numeric input", () => {
    const result = provider.validateCoordinates({ latitude: NaN, longitude: 0 });
    expect(result.valid).toBe(false);
  });
});

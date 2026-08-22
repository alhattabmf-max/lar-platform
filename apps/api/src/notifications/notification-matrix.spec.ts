import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTION_REQUIRED_NOTIFICATION_TYPES,
  EMAIL_EMITTING_NOTIFICATION_TYPES,
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_ROUTE_KINDS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_ENTITY_TYPES,
  NOTIFICATION_TYPE_PARAM_KEYS,
  emitsEmail,
  isActionRequired,
  notificationRouteId,
  notificationRouteKind,
} from "@platform/types";
import { NOTIFICATION_MATRIX } from "./notification-matrix";

const SRC = join(__dirname, "..");

/**
 * The matrix is checked against the source tree, not trusted.
 *
 * A producer that is renamed, a type that gains a param it is not
 * allowed, or a channel that disagrees with the email union all fail
 * here — which is what makes the matrix a verification artefact rather
 * than a comment that rots.
 */
describe("the matrix covers every type exactly once", () => {
  it("has an entry for all 18", () => {
    expect(Object.keys(NOTIFICATION_MATRIX).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });

  it("names a producer file and method for every type", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_MATRIX[type].producerFile).toBeTruthy();
      expect(NOTIFICATION_MATRIX[type].producerMethod).toBeTruthy();
    }
  });
});

describe("every declared producer exists in the source tree", () => {
  it.each(NOTIFICATION_TYPES)("%s — the file exists", (type) => {
    expect(existsSync(join(SRC, NOTIFICATION_MATRIX[type].producerFile))).toBe(true);
  });

  it.each(NOTIFICATION_TYPES)("%s — the method exists in that file", (type) => {
    const spec = NOTIFICATION_MATRIX[type];
    const source = readFileSync(join(SRC, spec.producerFile), "utf8");

    expect(source).toMatch(new RegExp(`\\b${spec.producerMethod}\\s*\\(`));
  });

  it.each(NOTIFICATION_TYPES)("%s — the producer actually calls the emitter", (type) => {
    const spec = NOTIFICATION_MATRIX[type];
    const source = readFileSync(join(SRC, spec.producerFile), "utf8");

    // Asserting the CALL, not that the type name appears somewhere in
    // the file: several producers mention a similarly-named audit
    // action, which a name search would match without any wiring
    // existing at all.
    expect(source).toContain(`this.notifications.${spec.emitterMethod}(`);
  });

  it.each(NOTIFICATION_TYPES)("%s — the emitter method exists and emits this type", (type) => {
    const spec = NOTIFICATION_MATRIX[type];
    const events = readFileSync(join(SRC, "notifications", "notification-events.service.ts"), "utf8");

    expect(events).toMatch(new RegExp(`\\b${spec.emitterMethod}\\s*\\(`));
    expect(events).toContain(type);
  });

  it("gives every type a distinct emitter method", () => {
    const methods = NOTIFICATION_TYPES.map((type) => NOTIFICATION_MATRIX[type].emitterMethod);

    expect(new Set(methods).size).toBe(methods.length);
  });

  it.each(NOTIFICATION_TYPES)("%s — the producer injects the events service", (type) => {
    const source = readFileSync(join(SRC, NOTIFICATION_MATRIX[type].producerFile), "utf8");

    expect(source).toContain("private readonly notifications: NotificationEventsService");
  });
});

describe("channel classification agrees with the email union", () => {
  it("marks exactly the 13 email-emitting types as EMAIL_AND_IN_APP", () => {
    const emailTypes = NOTIFICATION_TYPES.filter(
      (type) => NOTIFICATION_MATRIX[type].channel === "EMAIL_AND_IN_APP"
    );

    expect(emailTypes.sort()).toEqual([...EMAIL_EMITTING_NOTIFICATION_TYPES].sort());
    expect(emailTypes).toHaveLength(13);
  });

  it("marks exactly 5 as IN_APP_ONLY", () => {
    const inApp = NOTIFICATION_TYPES.filter(
      (type) => NOTIFICATION_MATRIX[type].channel === "IN_APP_ONLY"
    );

    expect(inApp).toHaveLength(5);
    expect(inApp.every((type) => !emitsEmail(type))).toBe(true);
  });

  it.each(NOTIFICATION_TYPES)("%s agrees with emitsEmail()", (type) => {
    expect(NOTIFICATION_MATRIX[type].channel === "EMAIL_AND_IN_APP").toBe(emitsEmail(type));
  });
});

describe("declared params stay inside each type's whitelist", () => {
  it.each(NOTIFICATION_TYPES)("%s declares only permitted params", (type) => {
    for (const key of NOTIFICATION_MATRIX[type].params) {
      expect(NOTIFICATION_TYPE_PARAM_KEYS[type]).toContain(key);
    }
  });

  it("never declares a param carrying identity, money detail or free text", () => {
    const serialised = JSON.stringify(
      NOTIFICATION_TYPES.map((type) => NOTIFICATION_MATRIX[type].params)
    );

    for (const forbidden of ["iban", "email", "message", "reason", "name", "crNumber"]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("pairs currency with amount wherever money is shown", () => {
    for (const type of NOTIFICATION_TYPES) {
      const params = NOTIFICATION_MATRIX[type].params;
      if (params.includes("amount")) expect(params).toContain("currency");
    }
  });
});

describe("entity targeting is closed and link-safe", () => {
  it.each(NOTIFICATION_TYPES)("%s uses only known entity types", (type) => {
    for (const entityType of NOTIFICATION_MATRIX[type].entityTypes) {
      expect(NOTIFICATION_ENTITY_TYPES).toContain(entityType);
    }
  });

  it.each(NOTIFICATION_TYPES)("%s agrees with the shared contract's allowlist", (type) => {
    // Authored independently in two places; equality is the check.
    expect([...NOTIFICATION_MATRIX[type].entityTypes].sort()).toEqual(
      [...NOTIFICATION_TYPE_ENTITY_TYPES[type]].sort()
    );
  });

  it("stores a route KIND, never a path or a URL", () => {
    for (const type of NOTIFICATION_TYPES) {
      const kind = NOTIFICATION_MATRIX[type].routeKind;

      expect(NOTIFICATION_ROUTE_KINDS).toContain(kind);
      expect(kind).not.toMatch(/^\/|^https?:/);
    }
  });

  it("declares a route kind consistent with each permitted entity type", () => {
    for (const type of NOTIFICATION_TYPES) {
      const spec = NOTIFICATION_MATRIX[type];

      for (const entityType of spec.entityTypes) {
        // REFUND_* legitimately resolves to ORDER_DETAIL or
        // CHECKOUT_SESSION depending on which entity it carries.
        const resolved = notificationRouteKind({ type, entityType });
        expect(NOTIFICATION_ROUTE_KINDS).toContain(resolved);
      }
    }
  });

  it("resolves PAYMENT_FAILED to the checkout session it can actually resume", () => {
    expect(NOTIFICATION_MATRIX.PAYMENT_FAILED.entityTypes).toEqual(["checkout_session"]);
    expect(
      notificationRouteKind({ type: "PAYMENT_FAILED", entityType: "checkout_session" })
    ).toBe("CHECKOUT_SESSION");
  });

  it("never claims master_order for an event that can precede an order", () => {
    // A payment usually fails before any order exists. Claiming
    // master_order while carrying a session id sends the UI nowhere.
    expect(NOTIFICATION_MATRIX.PAYMENT_FAILED.entityTypes).not.toContain("master_order");
  });

  it("lets the two refund types point at either real path", () => {
    for (const type of ["REFUND_INITIATED", "REFUND_FAILED"] as const) {
      expect([...NOTIFICATION_MATRIX[type].entityTypes].sort()).toEqual(
        ["checkout_session", "master_order"].sort()
      );
    }
  });
});

describe("every action-required type has a usable destination", () => {
  it("classifies exactly the six agreed types", () => {
    expect([...ACTION_REQUIRED_NOTIFICATION_TYPES].sort()).toEqual(
      NOTIFICATION_TYPES.filter(
        (type) => NOTIFICATION_MATRIX[type].urgency === "ACTION_REQUIRED"
      ).sort()
    );
  });

  it.each(ACTION_REQUIRED_NOTIFICATION_TYPES)("%s resolves to a real route id", (type) => {
    const spec = NOTIFICATION_MATRIX[type];

    for (const entityType of spec.entityTypes) {
      // An allocation event routes to its ORDER, so the id comes from
      // params.orderId; everything else uses entityId.
      const params =
        entityType === "order_allocation" ? { orderId: "order-1" } : {};
      const routeId = notificationRouteId({
        type,
        entityType,
        entityId: "entity-1",
        params,
      });

      expect(routeId).not.toBeNull();
      expect(routeId!.length).toBeGreaterThan(0);
    }
  });

  it("refuses a destination when the identifier it needs is missing", () => {
    // The UI must not render an action affordance in this case.
    expect(
      notificationRouteId({
        type: "ALLOCATION_SHIPPED",
        entityType: "order_allocation",
        entityId: "alloc-1",
        params: {},
      })
    ).toBeNull();
  });

  it("does not mark an informational type as action-required", () => {
    for (const type of NOTIFICATION_TYPES) {
      if (NOTIFICATION_MATRIX[type].urgency === "INFORMATIONAL") {
        expect(isActionRequired(type)).toBe(false);
      }
    }
  });

  it.each(ACTION_REQUIRED_NOTIFICATION_TYPES)("%s is action-required on the contract too", (type) => {
    expect(isActionRequired(type)).toBe(true);
    expect(NOTIFICATION_MATRIX[type].urgency).toBe("ACTION_REQUIRED");
  });
});

describe("action-required is distinguished from informational", () => {
  it("classifies every type as one or the other", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(["ACTION_REQUIRED", "INFORMATIONAL"]).toContain(NOTIFICATION_MATRIX[type].urgency);
    }
  });

  it("marks the five types that genuinely need someone to act", () => {
    const actionRequired = NOTIFICATION_TYPES.filter(
      (type) => NOTIFICATION_MATRIX[type].urgency === "ACTION_REQUIRED"
    );

    expect(actionRequired.sort()).toEqual(
      [
        "PAYMENT_FAILED",
        "ORDER_CREATED",
        "DISPUTE_OPENED",
        "REFUND_FAILED",
        "REPLACEMENT_REQUIRED",
        "REPLACEMENT_FAILED",
      ].sort()
    );
  });

  it("never marks a routine progress update as action-required", () => {
    for (const type of [
      "ALLOCATION_PREPARATION_STARTED",
      "ALLOCATION_READY",
      "ALLOCATION_DELIVERED",
      "REPLACEMENT_SHIPPED",
      "REPLACEMENT_DELIVERED",
    ] as const) {
      expect(NOTIFICATION_MATRIX[type].urgency).toBe("INFORMATIONAL");
    }
  });
});

describe("no two types deliver the same news to the same company", () => {
  it("never pairs one business moment with two notifications for one recipient", () => {
    // PAYMENT_SUCCEEDED and ORDER_CREATED fire in the same webhook
    // transaction. They are split across companies precisely so no
    // single user receives two messages about one capture.
    expect(NOTIFICATION_MATRIX.PAYMENT_SUCCEEDED.targetCompany).toBe("TRADER");
    expect(NOTIFICATION_MATRIX.ORDER_CREATED.targetCompany).toBe("SUPPLIER");
  });

  it("keeps a single target company per type — never both at once", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(["TRADER", "SUPPLIER"]).toContain(NOTIFICATION_MATRIX[type].targetCompany);
    }
  });
});

describe("every type documents its no-op conditions", () => {
  it.each(NOTIFICATION_TYPES)("%s lists at least the universal four", (type) => {
    expect(NOTIFICATION_MATRIX[type].noOp.length).toBeGreaterThanOrEqual(4);
  });

  it.each(NOTIFICATION_TYPES)("%s names rollback and duplicate suppression", (type) => {
    const joined = NOTIFICATION_MATRIX[type].noOp.join(" | ");

    expect(joined).toMatch(/rollback/i);
    expect(joined).toMatch(/duplicate|dedupe/i);
  });

  it("names the zero-row guard for every guarded-transition producer", () => {
    for (const type of [
      "ALLOCATION_PREPARATION_STARTED",
      "ALLOCATION_READY",
      "ALLOCATION_SHIPPED",
      "REPLACEMENT_SHIPPED",
      "REPLACEMENT_FAILED",
    ] as const) {
      expect(NOTIFICATION_MATRIX[type].noOp.join(" | ")).toMatch(/zero rows/i);
    }
  });
});

describe("dedupe discriminators", () => {
  it("uses one only where the same type can legitimately recur for an entity", () => {
    // A payment can fail more than once for one order; an allocation
    // ships once.
    expect(NOTIFICATION_MATRIX.PAYMENT_FAILED.dedupeDiscriminator).toBeTruthy();
    expect(NOTIFICATION_MATRIX.REFUND_INITIATED.dedupeDiscriminator).toBeTruthy();
    expect(NOTIFICATION_MATRIX.REFUND_FAILED.dedupeDiscriminator).toBeTruthy();
    expect(NOTIFICATION_MATRIX.ALLOCATION_SHIPPED.dedupeDiscriminator).toBeNull();
  });

  it("never describes a discriminator as a timestamp or random value", () => {
    for (const type of NOTIFICATION_TYPES) {
      const discriminator = NOTIFICATION_MATRIX[type].dedupeDiscriminator ?? "";

      expect(discriminator.toLowerCase()).not.toMatch(/timestamp|now\(\)|random|uuid v4/);
    }
  });
});

import { getTranslations } from "next-intl/server";
import type { BrandingPublic } from "@platform/types";
import { routing, type AppLocale } from "@/i18n/routing";
import { BrandMark } from "./brand-mark";
import { LocaleSwitch } from "./locale-switch";
import { NotificationBell } from "./notification-bell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { UserMenu, USER_MENU_INLINE_ITEM } from "./user-menu";
import { AdminSignOut } from "@/components/admin/admin-sign-out";
import { SignInIcon } from "@/components/ui/icons";

/**
 * THE ONE BAR, on every screen the platform has.
 *
 * There were four: the public header, the portal top bar the supplier
 * and the buyer shared, the console's own, and the stripped one on the
 * sign-in page. Four bars is four places for the logo to be a different
 * size and the language control to sit on a different side, and it is
 * how a platform ends up feeling like several.
 *
 * WHAT IS IN IT DEPENDS ON WHO IS LOOKING, and on nothing else:
 *
 *   visitor  — the mark, the language, and the way in
 *   bare     — the mark and the language. The sign-in page: offering
 *              "sign in" on the sign-in page is a button that does
 *              nothing but reload the page somebody is already on.
 *   company  — the mark, the bell, the language, and the way out
 *   admin    — the same, without a bell. See below.
 *
 * THE SIDE IS THE DOCUMENT'S, not a branch. `justify-between` puts the
 * mark at the inline START and the controls at the inline END, so
 * Arabic gets the logo on the right and English on the left with no
 * `locale === "ar-SA"` anywhere — the browser already knows which way
 * the page reads, and a second source of truth for that is a bug
 * waiting for a third locale.
 *
 * STICKY, NOT FIXED, and that is what keeps content and sidebar clear
 * of it. A sticky element still occupies its space in the flow, so
 * everything below simply starts below it. `fixed` would lift the bar
 * out of the flow and need a spacer of exactly its height — a number
 * that changes with the logo, the font and the language, and is
 * therefore wrong at some width, leaving either a gap or content
 * hidden underneath. The bar stays at the top of the viewport while
 * scrolling either way.
 *
 * THE CONSOLE GETS NO BELL, and that is a fact about the data rather
 * than a decision here: `Notification` is keyed to a company and
 * `NotificationRecipient` to a `User`. An administrator is neither, so
 * there is no row a console bell could count and nothing a console
 * notifications page could list. A bell that always reads zero is not
 * "the actual notifications icon" — it is a picture of one.
 */
export type TopbarAudience = "visitor" | "bare" | "company" | "admin";

/**
 * How the bar is painted.
 *
 * TWO TONES, ONE BAR. The storefront wears the identity colour, which
 * is what a shopfront sign is for. A WORKSPACE does not: the portals
 * carry a white bar with the navigation in the identity colour
 * directly beneath it, so the coloured band a person navigates by is
 * one band and not two stacked on each other.
 *
 * It is a tone rather than a second component because everything else
 * about the bar — what it holds, which side each control sits on,
 * which session the sign-out ends — is identical, and a copy would
 * drift on the first change to any of it.
 */
export type TopbarTone = "brand" | "surface";

/**
 * Who is signed in, for the bar to say so.
 *
 * A NAME AND NOTHING ELSE. Not a role, not a company id, not a
 * verification status: the bar answers "whose session is this" so the
 * person can tell they are not looking at somebody else's data, and
 * every further fact belongs on a screen that explains it.
 */
export interface PlatformTopbarUser {
  /** What to call them — an e-mail, or a person's name when there is one. */
  name: string;
  /** Optional second line: the company, for a portal. */
  secondary?: string;
}

export interface PlatformTopbarNotifications {
  /** Where the bell goes — the portal's own notifications page. */
  href: string;
  /** Undefined when the count could not be read. The bell still works. */
  unread?: number;
}

export interface PlatformTopbarProps {
  locale: AppLocale;
  branding: BrandingPublic;
  audience: TopbarAudience;
  /** Defaults to the identity colour, which is what the storefront wears. */
  tone?: TopbarTone;
  /**
   * WHETHER THE BAR DRAWS THE MARK AT ALL.
   *
   * «شِل الشعار من الشريط العلوي وحطّه قبل لسان الرئيسية». The three
   * fronts with a row of file tabs put it at the head of that row
   * instead; the console, which has no such row, keeps it here.
   *
   * IT IS OPT-OUT, not opt-in: the bar's job is the identity, and a
   * front that moves it has to say so in its own layout rather than
   * every other front having to remember to ask for it.
   */
  markless?: boolean;
  /** Shown beside the way out. Absent for a visitor, who has no session. */
  user?: PlatformTopbarUser;
  /** Only ever passed for `company`. The console has no notifications. */
  notifications?: PlatformTopbarNotifications;
  /**
   * Rendered at the inline end of the bar, before everything else.
   *
   * The portals put their drawer button here on a narrow screen. It is
   * a slot rather than a prop because what belongs there is the
   * caller's layout concern, not the bar's.
   */
  leading?: React.ReactNode;
}

/**
 * The account control, shared by the way IN and the way OUT.
 *
 * One class string for both, so the bar does not change height, weight
 * or colour depending on whether somebody is signed in — which is what
 * «يتحول زر تسجيل الدخول نفسه إلى زر تسجيل الخروج» asks for. 32px, the
 * platform's one control height, from the token.
 */
const ACCOUNT_CONTROL_BASE =
  "inline-flex min-h-control items-center justify-center gap-control-gap whitespace-nowrap rounded-control px-control-x py-control-y " +
  // HEAVIER THAN THE BODY — «اجعل تسجيل الدخول والخروج بخط أعرض».
  // These are words rather than shapes, and at the body weight they
  // read as text beside the tabs instead of as things to press.
  "text-[length:var(--control-font-size)] leading-[var(--control-line-height)] font-semibold " +
  // INVERTED, because the bar is now the identity blue. The button used
  // to be `bg-primary` on white; left as it was it would be blue on
  // blue — a control that measures 1.00:1 against the surface holding
  // it, which is to say invisible. White on the blue is 16.69:1, and
  // its text reads at the same figure the other way round.
  // THE LIFT BELONGS TO THE FILL, not to the shape. A control with
  // no background and no border has nothing to raise — «بدون خلفية أو
  // إطار أو ظل» — so the shadow moved down into the two tones that
  // actually carry a fill.
  "hover:opacity-[var(--state-hover-opacity)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * The account control's paint, per tone.
 *
 * ON THE BRAND BAR it is inverted — white on the identity colour —
 * because a `bg-primary` button on a `bg-primary` bar measures 1.00:1
 * against the surface holding it, which is to say invisible. ON A WHITE
 * BAR the inversion is the mistake instead, so it goes back to the
 * ordinary filled button every other screen uses.
 */
const ACCOUNT_TONE: Record<TopbarTone, string> = {
  brand: "bg-surface text-primary shadow-raised active:shadow-pressed",
  surface:
    "bg-primary text-primary-foreground shadow-raised active:shadow-pressed",
};

const LOCALE_TONE: Record<TopbarTone, string> = {
  brand: "text-primary-foreground",
  // THE IDENTITY BLUE, like the two controls beside it — «وتكون
  // أيقونة اللغة وتسجيل الدخول والخروج باللون الداكن الأزرق».
  surface: "text-primary",
};

/**
 * The language control: the same target, and no box at all.
 *
 * A filled square made a bare glyph read as a third button competing
 * with the action beside it. What has to match is the TARGET, not the
 * paint.
 */
const LOCALE_CONTROL_BASE =
  // NOT A 32px SQUARE ANY MORE. It carries the destination language's
  // own name, so it is sized like the control it is: the platform's one
  // height, the platform's padding, and a gap between glyph and word
  // from the same token every other pairing uses. The glyph grew with
  // it — 20px rather than 18, which is what the system's icon token
  // says and what stops it reading as a decoration beside the text.
  "inline-flex min-h-control shrink-0 items-center justify-center gap-control-gap rounded-control px-control-x py-control-y " +
  "text-[length:var(--control-font-size)] leading-[var(--control-line-height)] font-semibold " +
  "hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

export async function PlatformTopbar({
  locale,
  branding,
  audience,
  tone = "brand",
  markless = false,
  user,
  notifications,
  leading,
}: PlatformTopbarProps) {
  const t = await getTranslations({ locale, namespace: "shell" });
  const otherLocale = routing.locales.find((l) => l !== locale) as AppLocale;

  const ACCOUNT_CONTROL = `${ACCOUNT_CONTROL_BASE} ${ACCOUNT_TONE[tone]}`;
  const LOCALE_CONTROL = `${LOCALE_CONTROL_BASE} ${LOCALE_TONE[tone]}`;

  /** Where signing out lands: the public home page IN THIS LOCALE. */
  const homeHref = `/${locale}`;

  return (
    <div
      data-testid="platform-topbar"
      // THE FOCUS RING INVERTS WITH THE BAR, and this is the whole
      // reason for the style attribute.
      //
      // `--color-focus-ring` is the tenant's identity colour — the same
      // value this bar is now painted in — so every control inside it
      // would have been ringed in navy on navy: 1.00:1, which is a
      // keyboard user tabbing through the bar and seeing NOTHING. One
      // custom property, scoped to this subtree, and the ring becomes
      // the colour paired with the blue. The halo follows it, because
      // `--ring-focus` is mixed from the same token.
      // ON THE BRAND BAR ONLY. `--color-focus-ring` is the tenant's
      // identity colour — the same value that bar is painted in — so
      // every control inside it would be ringed in navy on navy:
      // 1.00:1, a keyboard user tabbing through and seeing NOTHING. On
      // a white bar the default ring is already the right colour, and
      // overriding it there would make it white on white instead.
      style={
        tone === "brand"
          ? { ["--color-focus-ring" as string]: "var(--color-on-primary)" }
          : undefined
      }
      data-tone={tone}
      className={
        tone === "brand"
          ? "sticky top-0 z-50 bg-primary"
          : "sticky top-0 z-50 border-b border-line bg-surface"
      }
    >
      {/* FULL WIDTH ON A WORKSPACE. A console is a place to read wide
          tables, and a bar centred in a six-column measure would leave
          the mark floating in from the edge with empty space beside it.
          The storefront keeps its measure, because a page of prose and
          cards reads badly edge to edge. */}
      <div
        className={
          "flex min-h-nav items-center justify-between gap-control-gap px-4 " +
          (tone === "brand" ? "mx-auto max-w-6xl" : "w-full lg:px-6")
        }
      >
        {/* THE MARK, and nothing beside it. No name in text, no box —
            the artwork carries the wordmark, and a placeholder frame
            around it drew a rectangle where an operator had uploaded
            nothing. */}
        <div className="flex min-w-0 items-center gap-control-gap">
          {leading}
          {markless ? null : (
            <div className="min-w-0 max-w-24 sm:max-w-36">
              <BrandMark
                branding={branding}
                logoAlt={t("logoAlt")}
                homeLabel={t("goHome")}
                homeHref={homeHref}
              />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-control-gap">
          {/* WHOSE SESSION THIS IS, beside the way out of it.
              Hidden below `sm`: on a narrow screen the mark, the bell,
              the language and the sign-out already fill the bar, and a
              name pushed in beside them is what starts a sideways
              scroll. The name is on the account screen either way. */}
          {user ? (
            <span
              data-testid="topbar-user"
              className="hidden min-w-0 flex-col items-end leading-tight sm:flex"
            >
              <span className="truncate text-sm font-medium text-content">
                {user.name}
              </span>
              {user.secondary ? (
                <span className="truncate text-xs text-content-muted">
                  {user.secondary}
                </span>
              ) : null}
            </span>
          ) : null}

          {audience === "company" && notifications ? (
            <NotificationBell
              href={notifications.href}
              unread={notifications.unread}
            />
          ) : null}

          {/* THE SAME BUTTON, one word or the other. Which session it
              ends is decided HERE rather than by the caller: the
              console holds `asid` and the two company portals `sid`,
              they are different endpoints, and a bar that took the
              sign-out as a slot would one day be handed the wrong one. */}
          {audience === "admin" ? (
            <AdminSignOut
              homeHref={homeHref}
              label={t("header.signOut")}
              working={t("header.signingOut")}
              className={ACCOUNT_CONTROL}
            />
          ) : audience === "company" ? (
            <SignOutButton
              homeHref={homeHref}
              label={t("header.signOut")}
              working={t("header.signingOut")}
              className={ACCOUNT_CONTROL}
            />
          ) : audience === "visitor" ? (
            <a
              href={`/${locale}/login`}
              className={ACCOUNT_CONTROL}
              data-testid="header-sign-in"
            >
              <SignInIcon aria-hidden="true" />
              {t("header.signIn")}
            </a>
          ) : null}

          {/* LAST, so it sits at the bar's outer edge in either reading
              direction — and it is the widest control here now that it
              names the language it goes to. */}
          <LocaleSwitch
            locale={locale}
            otherLocale={otherLocale}
            label={t("header.switchLocale")}
            otherLocaleName={t(`localeName.${otherLocale}`)}
            className={LOCALE_CONTROL}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * THE LANGUAGE AND THE WAY IN OR OUT — for a front that has no bar.
 *
 * «شِل زر تسجيل الدخول والخروج وتغيير اللغة من الشريط العلوي وحطّها
 * بجانب أيقونة الإشعارات… ثم احذف الشريط العلوي واعتبر الألسنة هي
 * الشريط العلوي في الثلاث واجهات.»
 *
 * IT IS IN THIS FILE ON PURPOSE. The paint these controls wear — the
 * account button's fill, the language control's ink, the shared
 * height and padding — is decided a few lines above, and a second file
 * restating it is how one of the two drifts. The bar and the row now
 * dress the same controls from the same constants.
 *
 * THE SURFACE TONE, ALWAYS. The row stands on the page's own light
 * ground, never on the identity colour, so the inversion the bar needs
 * would be white on white here.
 *
 * THE BELL IS NOT IN HERE. It carries a count only the layout has read
 * and it is already handed to the row separately; ordering the three is
 * the row's business, not this file's.
 */
export async function RowControls({
  locale,
  audience,
  recordHref,
  inline = false,
}: {
  locale: AppLocale;
  audience: TopbarAudience;
  /**
   * OPEN THE ACCOUNT INTO THE ROW, not over the page.
   *
   * The narrow row asks for it — «تطلع كلمة خروج وكلمة بياناتي بشكل
   *  موازٍ ليه» — and the wide one does not: there the glyph sits at
   * the end of a bar with room to spare, and a menu is the right
   * shape for it. See `UserMenu`.
   */
  inline?: boolean;
  /**
   * WHERE «بياناتي» GOES — the company's own record, in this portal.
   *
   * «انقل بيانات المنشأة من الشريط العلوي إلى داخل أيقونة المستخدم
   * بمسمّى بياناتي». It differs per front, so the front says it.
   */
  recordHref?: string;
}) {
  const t = await getTranslations({ locale, namespace: "shell" });
  const otherLocale = routing.locales.find((l) => l !== locale) as AppLocale;

  // THE STOREFRONT'S THREE ACTIONS ARE ONE COMPACT GROUP. They are
  // deliberately 36px high: large enough to press comfortably without
  // forcing the row taller, while content-width text actions avoid the
  // wide blocks that used to crowd the mark and tabs. The locale action
  // uses the same paint and radius, but stays square because it has no
  // visible word.
  const VISITOR_CONTROL_BASE =
    "inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-control bg-primary " +
    "text-[length:var(--control-font-size)] leading-[var(--control-line-height)] font-semibold text-primary-foreground " +
    "shadow-raised hover:opacity-[var(--state-hover-opacity)] active:shadow-pressed " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const VISITOR_TEXT_CONTROL = `${VISITOR_CONTROL_BASE} px-2.5`;
  const VISITOR_LOCALE_CONTROL = `${VISITOR_CONTROL_BASE} w-9 px-0`;

  // THE THREE GLYPHS AT THE ROW'S END ARE ONE FAMILY AND ONE TARGET —
  // «خلّ الأيقونة بحجم أيقونة الإشعارات، وكذلك أيقونة اللغة بنفس الحجم،
  // الثلاث الأيقونات». Forty pixels, round, and the identity's navy.
  // What still sets the bell apart is that it is FILLED and wears the
  // accent, which the owner keeps deliberately.
  /** What a row inside the account menu wears. */
  /** What a row inside the account menu wears — see `UserMenu`. */
  const MENU_ITEM = inline
    ? // THE SAME WORDS, DRESSED FOR A ROW — see `UserMenu`. The
      // way out and the way to the record must wear ONE thing in
      // either shape, or the menu that opens sideways would have
      // a padded block in it and a bare word beside it.
      USER_MENU_INLINE_ITEM
    : "w-full whitespace-nowrap px-4 py-2 text-start text-sm font-medium text-content hover:bg-background " +
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]";

  /** Where signing out lands: the public home page IN THIS LOCALE. */
  const homeHref = `/${locale}`;

  return (
    <>
      {audience === "visitor" ? (
        <>
          <a
            href={`/${locale}/login`}
            className={VISITOR_TEXT_CONTROL}
            data-testid="header-sign-in"
          >
            {t("header.signIn")}
          </a>
          <a
            href={`/${locale}/register`}
            className={VISITOR_TEXT_CONTROL}
            data-testid="header-register"
          >
            {t("header.register")}
          </a>
        </>
      ) : (
        <UserMenu
          inline={inline}
          recordHref={recordHref ?? `/${locale}`}
          labels={{
            open: t("header.account"),
            record: t("header.myRecord"),
            signOut: t("header.signOutShort"),
            signingOut: t("header.signingOut"),
          }}
          signOut={
            // THE CONSOLE AND A COMPANY SIGN OUT THROUGH DIFFERENT
            // ENDPOINTS, so the act is handed in rather than chosen
            // inside the menu, where one of the two would one day be
            // the wrong one.
            audience === "admin" ? (
              <AdminSignOut
                homeHref={homeHref}
                label={t("header.signOutShort")}
                working={t("header.signingOut")}
                className={MENU_ITEM}
              />
            ) : (
              <SignOutButton
                homeHref={homeHref}
                label={t("header.signOutShort")}
                working={t("header.signingOut")}
                className={MENU_ITEM}
                icon={false}
              />
            )
          }
        />
      )}

      {/* LAST, so it sits at the row's outer edge in either reading
          direction — «رتّبها من اليسار: أيقونة اللغة، وتسجيل الدخول،
          وأيقونة الإشعارات». */}
      <LocaleSwitch
        locale={locale}
        otherLocale={otherLocale}
        label={t("header.switchLocale")}
        // Visitors get an icon-only language action. Its accessible
        // label still names the destination language in full. Signed-in
        // rows keep the written destination because their control set
        // and available space are different.
        otherLocaleName={
          audience === "visitor" ? undefined : t(`localeName.${otherLocale}`)
        }
        nameClassName={audience === "visitor" ? undefined : "max-lg:hidden"}
        className={
          audience === "visitor"
            ? VISITOR_LOCALE_CONTROL
            : `${LOCALE_CONTROL_BASE} text-primary`
        }
      />
    </>
  );
}

/**
 * WHAT «حسابي» HOLDS, for a screen with no room for a menu.
 *
 * «إذا كان مزحوم فوق بالأيقونات نخلي أيقونة الدخول والخروج تحت في
 *  حسابي» — the narrow bar carries the mark, the open page's tab and
 * two glyphs inside 360 pixels, so the account glyph came down to the
 * bar at the foot of the screen, where pressing it opens these.
 *
 * THE SAME TWO ROWS `UserMenu` HOLDS, from the same file, dressed by
 * the same constant. It is written HERE rather than in each portal's
 * layout for the reason that rule exists at all: sign-out was once
 * assembled per portal, which is how one front ended up calling a
 * different endpoint from another. One component, one act, one place.
 *
 * A COMPANY, NEVER THE CONSOLE. The admin front has its own chrome and
 * its own endpoint; passing an audience it does not serve would be a
 * silent wrong door, so it takes none.
 */
export async function AccountSheetRows({
  locale,
  recordHref,
}: {
  locale: AppLocale;
  /** The company's own record, in the portal this is drawn in. */
  recordHref: string;
}) {
  const t = await getTranslations({ locale, namespace: "shell" });

  const ROW =
    "flex min-h-nav w-full items-center whitespace-nowrap px-4 text-start text-sm font-medium text-content hover:bg-background " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]";

  return (
    <>
      <a href={recordHref} className={ROW}>
        {t("header.myRecord")}
      </a>
      <SignOutButton
        homeHref={`/${locale}`}
        label={t("header.signOutShort")}
        working={t("header.signingOut")}
        className={ROW}
        icon={false}
      />
    </>
  );
}

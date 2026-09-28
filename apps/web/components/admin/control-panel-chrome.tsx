"use client";

import { useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { PortalChrome } from "@/components/portal/portal-chrome";
import type { PortalTopNavLabels } from "@/components/portal/portal-top-nav";
import {
  ContextualHelpPanel,
  type ContextualHelpPanelLabels,
} from "./contextual-help-panel";
import { CONTROL_PANEL_MAP, locateControlPanelPage } from "./control-panel-nav";
import { AdminTopNav } from "./admin-top-nav";
import { AdminSectionRow } from "./admin-section-row";

/**
 * The console's frame: the shared portal chrome, plus the help panel.
 *
 * WHY THE HELP PANEL LIVES HERE and not in the shared chrome — it is
 * the one piece of this frame no other portal has. The buyer's and the
 * supplier's have no approved help content, and a question mark that
 * opens an empty drawer is a control that lies about what it does.
 *
 * It also needs its own owner: the button that opens it must be handed
 * focus again when it closes, and that only works if one component
 * holds both refs.
 */

/**
 * The console's only remaining topbar string.
 *
 * The sign-out, the language control and the account menu left with the
 * old bar — `PlatformTopbar` renders all three now, the same way for
 * all three audiences. What is left is the help control, which is the
 * console's alone.
 */
export interface ControlPanelTopbarLabels {
  help: string;
}

export interface ControlPanelChromeProps {
  basePath: string;
  nav: PortalTopNavLabels;
  topbar: ControlPanelTopbarLabels;
  /** THE PLATFORM'S ONE BAR, already rendered by the layout. */
  /**
   * THE PLATFORM'S BAR — the mark, the language and the way out.
   *
   * IT IS THE ROW'S OWN CONTENTS NOW rather than a bar above it:
   * «الشريط العلوي أبيض، فيه الشعار والأيقونات، وتحته الوجهات».
   */
  brand?: ReactNode;
  controls?: ReactNode;
  mobileControls?: ReactNode;
  help: ContextualHelpPanelLabels;
  /** Accessible name for the breadcrumb trail. */
  /**
   * KEPT ON THE PROPS, UNREAD HERE.
   *
   * The console draws no trail any more — «ألغِ التعليمات ذي لأنها
   *  شرح ولا أحتاج شرح… صحيح، في جميع الصفحات» — and the shell
   * still translates the word, so the prop stays rather than
   * rippling a removal through the layout for one string.
   */
  breadcrumbLabel?: string;
  children: ReactNode;
}

export function ControlPanelChrome({
  basePath,
  nav,
  topbar,
  brand,
  controls,
  mobileControls,
  help,
  children,
}: ControlPanelChromeProps) {
  const pathname = usePathname();
  const here = locateControlPanelPage(pathname);

  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);

  const control =
    "inline-flex h-10 min-h-10 min-w-10 items-center justify-center rounded-md text-content " +
    "hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <>
      <PortalChrome
        basePath={basePath}
        map={CONTROL_PANEL_MAP}
        nav={nav}
        // NO PLATFORM BAR ABOVE THE ROW. The console kept it while
        // the three fronts dropped theirs — «اعتمدها مع الواجهات
        //  الثلاث في التصميم» — and the mark and the controls stand
        // IN the row now, exactly as they do everywhere else.
        topbar={null}
        // THE PAGE IS A SHEET, as it is on the other three.
        mainSurface
        // AND THE OPEN SECTION'S SCREENS STAND UNDER THE RULE —
        // «تنزل تحت الشريط البرتقالي عند الضغط على اسم القسم». It
        // draws nothing on the dashboard, which belongs to no
        // section.
        band={
          <AdminSectionRow
            basePath={basePath}
            labels={nav}
            pathname={pathname}
            action={
              <button
                type="button"
                ref={helpButtonRef}
                onClick={() => setHelpOpen(true)}
                className={control}
                aria-label={topbar.help}
                title={topbar.help}
                data-testid="control-panel-help-button"
              >
                <CircleHelp aria-hidden="true" className="size-5" />
              </button>
            }
          />
        }
        navSlot={
          <AdminTopNav
            basePath={basePath}
            labels={nav}
            brand={brand}
            controls={controls}
            mobileControls={mobileControls}
            pathname={pathname}
          />
        }
        // NO TRAIL — «ألغِ التعليمات ذي لأنها شرح ولا أحتاج شرح».
        //
        // IT ANSWERED A QUESTION THE ROW NOW ANSWERS. «الطلبات وخدمة
        //  العملاء › الطلبات» said which section holds the open
        // screen; the screens of that section stand under the rule
        // with the open one lit. The trail was the same sentence,
        // spelled out.
        //
        // AND THE PAGE DREW ITS OWN AS WELL, so the console showed
        // both at once — «هنا أنت مكرّر العناوين».
        breadcrumbs={null}

      >
        {children}
      </PortalChrome>

      <ContextualHelpPanel
        open={helpOpen}
        onClose={() => {
          setHelpOpen(false);
          helpButtonRef.current?.focus();
        }}
        labels={help}
        pageName={here ? (nav.pageNames[here.page.key] ?? "") : ""}
        // No approved help content exists for any control panel screen
        // yet, so every screen shows the empty state. When content is
        // approved it arrives here rather than being written inline.
        body={null}
      />
    </>
  );
}

@standalone @wave0 @hud-skin @phase-1
Feature: The HUD kit and its gallery
  One shared SAO style look for both windows: light, slightly see-through panels,
  a very thin black frame that follows cut corners, a drawn title bar, resize
  handles, HUD buttons and an HP style progress bar. This phase builds the pieces
  and a gallery page that runs in a browser on its own, with fixture text only,
  before either card uses them. It does not need any other module.

  Scenario: The gallery runs on its own
    When the HUD gallery command is run
    Then a development server starts
    And opening it shows every HUD piece filled with fixture card text

  Scenario: Body text stays readable on the panel
    When the body text colour and the panel colour are read from the HUD stylesheet
    Then their contrast ratio is at least 4.5 to 1

  Scenario Outline: The HP bar fills in proportion to progress
    When the HP bar is given <done> done out of <total>
    Then it is filled to <percent> percent

    Examples:
      | done | total | percent |
      | 0    | 4     | 0       |
      | 1    | 4     | 25      |
      | 4    | 4     | 100     |
      | 5    | 4     | 100     |
      | 0    | 0     | 0       |

  Scenario: Without the frameless class there is no drawn title bar
    Given the page root does not have the frameless class
    When a HUD panel is shown
    Then there is no drawn title bar
    And there are no resize handles

  Scenario: Outside the desktop app the title bar has no window buttons
    Given the page is not running inside the desktop app
    And the page root has the frameless class
    When a HUD panel is shown
    Then the drawn title bar shows the window title
    And it has no minimize button and no close button
    And no error is reported

  Scenario: The drawn close button asks the window to close the normal way
    Given the page is running inside the desktop app
    And the page root has the frameless class
    When the drawn close button is pressed
    Then the window is asked to close through the same request the system close button sends
    And nothing ends the application or hides the window directly

  Scenario: The HUD styles load nothing from outside
    When the HUD stylesheets and components are scanned
    Then no element carries an inline style attribute
    And no font, image or stylesheet is loaded from another host

  Scenario: The bundled font carries its licence
    When the HUD font directory is listed
    Then every font file has an open font licence text next to it

  Scenario: Animations stop when less motion is requested
    Given the system asks for reduced motion
    When the HUD stylesheet is applied
    Then no HUD piece animates or transitions

  # The scenarios below were added after the manual review of 2026-10-15 (ticket T14). They draw the
  # gallery in a headless Chrome (LC_CHROME, or a usual install path; missing Chrome is a failure, not
  # a skip) at 720 x 900 with one image pixel per CSS pixel, and measure pixels and computed styles.
  # Nothing is sent to the mouse or the keyboard: hover and focus are forced through DevTools.
  # The measuring helpers are in packages/ui-shared/src/hud/render-test-support.ts.

  Scenario: The panel lets the page behind it show through
    When the gallery is drawn in a headless browser
    Then every sampled pixel in the panel padding equals the panel colour laid over the pixel behind it

  Scenario: On the dark backdrop the panel is visibly see-through
    Given the gallery backdrop is switched to dark
    When the gallery is drawn in a headless browser
    Then the page behind the panel is dark and carries a high contrast pattern
    And every sampled pixel in the panel padding equals the panel colour laid over the pixel behind it
    And the shared stylesheet says nothing about the gallery

  Scenario: Every frame line is one pixel wide
    Given the third gallery button is labelled with Latin letters only
    When the gallery is drawn in a headless browser
    Then each straight edge of the panel and of every button is one pixel wide
    And each cut corner of the panel still has its thin line

  Scenario: Keyboard focus looks different from hover
    When the gallery is drawn in a headless browser
    Then the focused second button differs in pixels from both the hovered and the normal one
    And its computed style differs from the hovered one

  Scenario: The shared stylesheet does not paint the page behind the panels
    When the HUD stylesheet rules for the page root are read
    Then none of them sets a background, except under the solid class

  Scenario: Latin capitals are about as tall as Chinese characters
    When the gallery is drawn in a headless browser
    Then a Latin capital in the display font is between 0.78 and 0.92 of the height of a Chinese character
    And the Rajdhani font face declares a size adjustment above 100 percent

  @manual
  Scenario: The gallery looks like an SAO style HUD
    When the gallery is opened
    Then the panels are light and slightly see-through
    And every frame is a very thin black line that follows the cut corners
    And hover and keyboard focus are marked in orange
    And the HP bars are green with a slanted end and a thin black outline

  @manual
  Scenario: The solid fallback fills the corners
    When the solid switch is turned on in the gallery
    Then the area outside the cut corners is filled with a solid colour
    And nothing else on the page moves

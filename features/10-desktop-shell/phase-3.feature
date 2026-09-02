@i5 @desktop-shell @phase-3
Feature: Tray, autostart and staying out of the way
  The point of this phase is that the person stops having to remember.

  @manual
  Scenario: The tray icon shows what is due
    Given five cards are due today
    When the application starts
    Then a tray icon appears
    And it shows the number due

  @manual
  Scenario: The tray menu
    When the tray icon is activated
    Then the menu offers opening each card, pausing the day, settings and quitting

  @manual
  Scenario: Closing a window hides it
    When a window is closed from its title bar
    Then the window hides
    And the process keeps running
    And it can be reopened from the tray

  @manual
  Scenario: Quitting
    When quit is chosen from the tray
    Then the process ends
    And all state has been written

  Scenario: Autostart can be turned on and off
    When autostart is enabled in settings
    Then the application registers itself to start at login
    And disabling it removes the registration

  @manual
  Scenario: Starting at login opens nothing
    Given autostart is enabled
    When the machine is restarted and the person logs in
    Then the tray icon appears
    And no window opens by itself

  @manual
  Scenario: Missing tray support degrades rather than breaks
    Given the desktop environment has no tray support
    When the application starts
    Then it still runs
    And it shows a one time note about what to install
    And keyboard shortcuts are offered instead of the menu

  Scenario: The due count refreshes
    When an hour passes
    Then the due count is recomputed
    And crossing midnight recomputes it immediately

  @manual
  Scenario: Pausing the day
    When pause today is chosen
    Then the menu item becomes an unpause action
    And the test card says the day is paused
    And the tray count shows a dash

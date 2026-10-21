package com.qxmatrix.edumanager.standalone

/**
 * Keeps page rendering behind a stable seven-domain boundary so MainActivity only owns the app
 * shell, navigation and Android system-result entry points. Page implementations can move out
 * independently without changing saved navigation state.
 */
class StandalonePageControllers(
    home: () -> Unit,
    archives: () -> Unit,
    materials: () -> Unit,
    learning: () -> Unit,
    reports: () -> Unit,
    projects: () -> Unit,
    settings: () -> Unit,
) {
    private val controllers: Map<AppSection, PageController> = mapOf(
        AppSection.HOME to LambdaPageController(home),
        AppSection.ARCHIVES to LambdaPageController(archives),
        AppSection.MATERIALS to LambdaPageController(materials),
        AppSection.LEARNING to LambdaPageController(learning),
        AppSection.REPORTS to LambdaPageController(reports),
        AppSection.PROJECTS to LambdaPageController(projects),
        AppSection.SETTINGS to LambdaPageController(settings),
    )

    fun render(section: AppSection) = requireNotNull(controllers[section]).render()
}

fun interface PageController { fun render() }
private class LambdaPageController(private val action: () -> Unit) : PageController {
    override fun render() = action()
}

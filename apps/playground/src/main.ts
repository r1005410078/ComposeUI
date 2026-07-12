import { mountEditor } from "@composeui/editor"
import "@composeui/editor/editor.css"
import { createM1Scenario } from "./m1-free-layout-scenario"
import "./styles.css"

const app = document.querySelector<HTMLElement>("#app")
if (app === null) throw new Error("PLAYGROUND_INIT_FAILED")

const { editor, pageId } = createM1Scenario()
const mounted = mountEditor(app, editor, { pageId })

if (import.meta.env.DEV) {
  Object.assign(window, { __composeuiM1: { editor, mounted } })
}

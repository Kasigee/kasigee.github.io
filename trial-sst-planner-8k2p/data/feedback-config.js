/**
 * UNE 2027 Course & Unit Planner — Bug Reporter & Staff Handover Config
 *
 * Edit ONLY this file to change where bug reports go when handing over to
 * UNE professional staff (no changes to js/app.js required).
 *
 * Supported delivery modes:
 *   "formsubmit" -> Zero-backend instant email via formsubmit.co (works best with Gmail / non-quarantined inboxes).
 *   "webhook"    -> Direct JSON POST to a UNE Power Automate / M365 HTTP trigger (recommended for UNE staff handover).
 *   "mailto"     -> Opens the tester's email client (Outlook/Mail) pre-addressed & pre-filled (zero external services).
 */
window.UNE_FEEDBACK_CONFIG = {
  mode: "formsubmit",

  // Label shown inside the Report an Issue dialog (e.g. "Course Advice Team" after handover)
  recipientLabel: "the trial inbox",

  // Destination email (used by "formsubmit" and the automatic "mailto:" fallback)
  emailUser: "kasimirpgregory",
  emailDomain: "gmail.com",

  // Optional: after clicking FormSubmit's first-time "Activate Form" email, paste the random alias token here
  // so the raw email address does not need to stay in source.
  formSubmitAlias: "",

  // Optional: for UNE handover, create a Power Automate flow ("When an HTTP request is received" ->
  // Send an email (V2) / Create SharePoint item), paste its HTTP POST URL below, and set mode: "webhook".
  webhookUrl: "",

  // Consistent subject prefix for one-click Gmail filter / Outlook inbox folder rules
  subjectPrefix: "[UNE Planner Bug]",

  // Optional: link to a shared Microsoft Forms / SharePoint / Teams tracker shown in the modal
  formUrl: "",
  sharedDocLabel: "Shared Feedback Tracker",
};

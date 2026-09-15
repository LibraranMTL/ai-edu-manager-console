---
title: "Use of All files access (MANAGE_EXTERNAL_STORAGE) permission - Play Console Help"
source: "https://support.google.com/googleplay/android-developer/answer/10467955"
imported_at: "2026-07-24T20:44:17"
clip_type: "webpage"
---

# Use of All files access (MANAGE_EXTERNAL_STORAGE) permission - Play Console Help

来源: https://support.google.com/googleplay/android-developer/answer/10467955

Skip to main content

[](/?tab=uu)

[Play Console Help](/googleplay/android-developer)

[](https://www.google.cn/intl/en/about/products?tab=uh)

[Sign in](https://accounts.google.com/ServiceLogin?hl=en&passive=true&continue=http://support.google.com/googleplay/android-developer/answer/10467955&ec=GAZAdQ)

[](/?tab=uu)

[Google Help](/)

[
  * Help Center](/googleplay/android-developer/?hl=en)[
    * Play Console Help](/googleplay/android-developer/topic/3308856?hl=en&ref_topic=9857238,2856718,)[
    * Policy Center](/googleplay/android-developer/topic/9858052?hl=en&ref_topic=9857238,2856718,)[
  * Community](/googleplay/android-developer/community?hl=en&help_center_link=CPP0_gQSPFVzZSBvZiBBbGwgZmlsZXMgYWNjZXNzIChNQU5BR0VfRVhURVJOQUxfU1RPUkFHRSkgcGVybWlzc2lvbg)[
  * Play Console](//play.google.com/apps/publish/)

[
  * Privacy Policy](//www.google.com/intl/en/privacy.html)[
  * Terms of Service](https://www.google.com/accounts/TOS)
  * Submit feedback




Send feedback on...

This help content & information

General Help Center experience

Next

  * [Help Center](/googleplay/android-developer/?hl=en)
  * [Community](/googleplay/android-developer/community?hl=en&help_center_link=CPP0_gQSPFVzZSBvZiBBbGwgZmlsZXMgYWNjZXNzIChNQU5BR0VfRVhURVJOQUxfU1RPUkFHRSkgcGVybWlzc2lvbg)
  * [Announcements](/googleplay/android-developer/announcements/13412212)



[Play Console](//play.google.com/apps/publish/)

  * Play Console Help

[Get started](/googleplay/android-developer/topic/3450769?hl=en&ref_topic=3308856,9857238,2856718,)[Popular articles](/googleplay/android-developer/topic/12233401?hl=en&ref_topic=3308856,9857238,2856718,)[Manage your developer account](/googleplay/android-developer/topic/16285?hl=en&ref_topic=3308856,9857238,2856718,)[Create, upload, and publish](/googleplay/android-developer/topic/7072031?hl=en&ref_topic=3308856,9857238,2856718,)[Distribute your app](/googleplay/android-developer/topic/7071529?hl=en&ref_topic=3308856,9857238,2856718,)[Run tests and check performance](/googleplay/android-developer/topic/7071528?hl=en&ref_topic=3308856,9857238,2856718,)[Paid apps, in-app products & subscriptions](/googleplay/android-developer/topic/3452890?hl=en&ref_topic=3308856,9857238,2856718,)[Protect your app](/googleplay/android-developer/topic/13878452?hl=en&ref_topic=3308856,9857238,2856718,)[Comply with Google Play policies](/googleplay/android-developer/topic/2364761?hl=en&ref_topic=3308856,9857238,2856718,)[Fix an issue](/googleplay/android-developer/topic/15868?hl=en&ref_topic=3308856,9857238,2856718,)[Android developer verification](/googleplay/android-developer/topic/16689288?hl=en&ref_topic=3308856,9857238,2856718,)[Central Play Help Center](/googleplay/android-developer/topic/14160281?hl=en&ref_topic=3308856,9857238,2856718,)

  * Policy Center

[Restricted Content](/googleplay/android-developer/topic/9877466?hl=en&ref_topic=9858052,9857238,2856718,)[Intellectual Property](/googleplay/android-developer/topic/9876963?hl=en&ref_topic=9858052,9857238,2856718,)[Privacy, Deception and Device Abuse](/googleplay/android-developer/topic/9877467?hl=en&ref_topic=9858052,9857238,2856718,)[Use of SDKs In Apps](/googleplay/android-developer/topic/15406736?hl=en&ref_topic=9858052,9857238,2856718,)[Malware](/googleplay/android-developer/topic/9975838?hl=en&ref_topic=9858052,9857238,2856718,)[Impersonation](/googleplay/android-developer/topic/9969539?hl=en&ref_topic=9858052,9857238,2856718,)[Mobile Unwanted Software](/googleplay/android-developer/topic/9969691?hl=en&ref_topic=9858052,9857238,2856718,)[Monetization and Ads](/googleplay/android-developer/topic/9857752?hl=en&ref_topic=9858052,9857238,2856718,)[Store Listing and Promotion](/googleplay/android-developer/topic/9877064?hl=en&ref_topic=9858052,9857238,2856718,)[Spam, Functionality, and User Experience](/googleplay/android-developer/topic/9876964?hl=en&ref_topic=9858052,9857238,2856718,)[Other Programs](/googleplay/android-developer/topic/9876660?hl=en&ref_topic=9858052,9857238,2856718,)[Families](/googleplay/android-developer/topic/9877766?hl=en&ref_topic=9858052,9857238,2856718,)[Enforcement](/googleplay/android-developer/topic/9877468?hl=en&ref_topic=9858052,9857238,2856718,)[Updates and Other Resources](/googleplay/android-developer/topic/9877065?hl=en&ref_topic=9858052,9857238,2856718,)[How Google Play Works for Developers](/googleplay/android-developer/topic/9958765?hl=en&ref_topic=9858052,9857238,2856718,)




  * [Use of app permissions and APIs](/googleplay/android-developer/topic/12798286?hl=en&ref_topic=2364761)
  * [Use of All files access (MANAGE_EXTERNAL_STORAGE) permission](/googleplay/android-developer/answer/10467955)



Notification

You can now request help from the [Help](https://play.google.com/console/developers/help-and-support) page in your Play Console account. If you don't have access to Play Console, ask your account admin for an invite.

# Use of All files access (MANAGE_EXTERNAL_STORAGE) permission

Google Play restricts the use of [high-risk or sensitive permissions](https://play.google.com/about/privacy-security-deception/permissions/), including special app access called [All files access](https://developer.android.com/preview/privacy/storage#all-files-access). This is only applicable to apps that target Android 11 (API level 30) and declare the `MANAGE_EXTERNAL_STORAGE` permission, which is added in Android 11. Also, this policy does not impact the usage of the `READ_EXTERNAL_STORAGE` permission.

If your app does not require access to the `MANAGE_EXTERNAL_STORAGE` permission, you must remove it from your app's manifest in order to successfully meet the policy review requirements. Details on policy-compliant alternative implementations are also enumerated below.

If your app meets the policy requirements for acceptable use or is eligible for an exception, you will be required to [declare this and any other high-risk permissions](https://support.google.com/googleplay/android-developer/answer/9214102) using the Permissions Declaration Form in Play Console.

Apps that fail to meet policy requirements or do not submit a Permissions Declaration Form may be removed from Google Play.

## When should you request the All files access permission?

You should only access the All files access permission when your app cannot effectively make use of the more privacy-friendly [best practices](https://developer.android.com/training/data-storage#scoped-storage), such as the [Storage Access Framework](https://developer.android.com/guide/topics/providers/document-provider) or the [MediaStore API](https://developer.android.com/training/data-storage/shared/media). Keep in mind that your app shouldn’t declare permissions that it doesn’t need or use.

### Core functionality

Additionally, the app’s usage of the permission must fall within permitted uses and must be directly tied to the core functionality of the app. Core functionality is defined as the main purpose of the app. Without this core functionality, the app is "broken" or rendered unusable. The core functionality, as well as any core features that comprise this core functionality, must all be prominently documented and promoted in the app's description.

When an app’s core functionality requires All files access permission, the developer must complete the [Permissions Declaration Form](https://support.google.com/googleplay/android-developer/answer/9214102?hl=en#zippy=%2Cstep-specify-your-apps-core-functionality:~:text=special%20instructions.-,Complete%20the%20Permissions%20Declaration%20Form,-Step%201%3A%20Evaluate) and receive approval from Google Play.

[Collapse All](/googleplay/android-developer/answer/10467955) Expand All

Permitted uses of the All files access permission

For apps requesting access to the All files access permission, intended and permitted use includes file managers, backup and restore apps, anti-virus apps, and document management apps.

Apps granted access to this permission may not extend its use to undisclosed or invalid purposes.

**Use** |  **Eligible permission***
---|---
**File management** App’s core purpose involves the access, editing, and management (including maintenance) of files and folders outside of its app-specific storage space |  `MANAGE_EXTERNAL_STORAGE`
**Backup and restore apps** App must have a need to automatically access multiple directories outside of its app-specific storage space for the purpose of backup and restore
**Anti-virus apps** App’s core purpose is to scan the device and provide anti-virus security features to the device user
**Document management apps** Apps that must locate, access, and edit compatible file types outside of its app-specific or shared storage App must justify in their Console declaration why the solutions documented in the [Access app-specific files](https://developer.android.com/training/data-storage/app-specific) or [Storage Access Framework](https://developer.android.com/guide/topics/providers/document-provider) (a privacy-friendly option) documentation are not sufficient for their purpose
**Search (On Device)** App’s core purpose is to search through files and folders across the device’s external storage
**Disk/Folder Encryption and Locking** App’s core purpose is to encrypt files and folders
**Device Migration/Phone transfer** App’s core purpose is to help the user migrate to a new device


* Subject to Google Play review and approval.

Exceptions

Google Play may provide a temporary exception to apps that do not qualify as permitted use designated above, when:

  * The use of the permission enables the app’s core functionality.
  * There is currently no alternative method to provide the core functionality, or the use of privacy-friendly alternatives (for example, [MediaStore API](https://developer.android.com/training/data-storage/shared/media) or [Storage Access Framework](https://developer.android.com/guide/topics/providers/document-provider)) has a substantially detrimental impact on the critical features of the app that are tied to the core functionality.
  * The impact on user privacy is mitigated by security and privacy best practices.



The developer must justify in their Console declaration why the [Storage Access Framework](https://developer.android.com/guide/topics/providers/document-provider) or [MediaStore API](https://developer.android.com/training/data-storage/shared/media) is not sufficient for their app’s purpose.

**Note:** Apps for carrier and OEM services, and private apps published under the [Managed Google Play distribution platform](https://developer.android.com/distribute/google-play/work) may request permission access for the above use cases, in addition to critical services that require access.

Invalid uses

In some cases, apps may wish to access sensitive user data for purposes where a safer and more secure alternative exists, or where the risk of data exposure doesn't warrant access.

Below is a list of common use cases that won't be permitted to request the `MANAGE_EXTERNAL_STORAGE` permission

  * Media Files access (see [Alternatives](https://support.google.com/googleplay/android-developer/answer/10467955#alternatives) below)
  * Any File selection activity where the user manually selects individual files (see [Alternatives](https://support.google.com/googleplay/android-developer/answer/10467955#alternatives) below)



**Note:** This list is not exhaustive. For in-depth guidance, refer to the [All files access](https://developer.android.com/preview/privacy/storage#all-files-access) documentation and [Scoped storage best practices](https://developer.android.com/training/data-storage#scoped-storage) guidance for developers.

Recommended privacy-friendly alternatives

**Use** |  **Alternatives**
---|---
Access of Media Files |  With the [MediaStore API](https://developer.android.com/training/data-storage/shared/media), apps can contribute and access media that’s available on an external storage volume without the need for the access All files permission. With the MediaStore API, users can easily retrieve and update media files. These files remain in the external storage volume on the user’s device — even after the app is uninstalled.
User selects files for importing/transferring/processing |  Developers should consider using Storage Access Framework as the [privacy-friendly option](https://developer.android.com/training/data-storage/use-cases#handle-non-media-files) for accessing files in shared storage. This framework supports the vast majority of use cases for apps to accomplish a full range of functionality.

**Important** If you change how your app uses these restricted permissions, you must submit the form again with updated and accurate information. Deceptive and undeclared uses of these permissions may result in a suspension of your app and/or termination of your developer account.

## Was this helpful?

How can we improve it?

YesNo

Submit

## Need more help?

### Try these next steps:

[ Post to the help community  Get answers from community members  ](/googleplay/android-developer/community?hl=en&help_center_link=CPP0_gQSPFVzZSBvZiBBbGwgZmlsZXMgYWNjZXNzIChNQU5BR0VfRVhURVJOQUxfU1RPUkFHRSkgcGVybWlzc2lvbg) [ Contact us Tell us more and we’ll help you get there ](/googleplay/android-developer/gethelp)

true

## [Use of app permissions and APIs](/googleplay/android-developer/topic/12798286?hl=en&ref_topic=2364761)

  * 1 of 12

[Declare permissions for your app](/googleplay/android-developer/answer/9214102?hl=en&ref_topic=12798286)
  * 2 of 12

[Understanding location in the background permissions](/googleplay/android-developer/answer/9799150?hl=en&ref_topic=12798286)
  * 3 of 12

Use of All files access (MANAGE_EXTERNAL_STORAGE) permission
  * 4 of 12

[Use of the broad package (App) visibility (QUERY_ALL_PACKAGES) permission](/googleplay/android-developer/answer/10158779?hl=en&ref_topic=12798286)
  * 5 of 12

[Use of the REQUEST_INSTALL_PACKAGES permission](/googleplay/android-developer/answer/12085295?hl=en&ref_topic=12798286)
  * 6 of 12

[Use of SMS or Call Log permission groups](/googleplay/android-developer/answer/10208820?hl=en&ref_topic=12798286)
  * 7 of 12

[Use of the AccessibilityService API](/googleplay/android-developer/answer/10964491?hl=en&ref_topic=12798286)
  * 8 of 12

[Remediation for Sensitive JavaScript Interface Vulnerability](/googleplay/android-developer/answer/10768383?hl=en&ref_topic=12798286)
  * 9 of 12

[​​Use of the isMonitoringTool Flag](/googleplay/android-developer/answer/12955211?hl=en&ref_topic=12798286)
  * 10 of 12

[Understanding Restricted Permissions with minimum scope alternatives](/googleplay/android-developer/answer/16935362?hl=en&ref_topic=12798286)
  * 11 of 12

[Minimum Scope: Foreground Location Access and the Location Button](/googleplay/android-developer/answer/17033915?hl=en&ref_topic=12798286)
  * 12 of 12

[Preview: Use of SMS or Call Log permission groups](/googleplay/android-developer/answer/17225965?hl=en&ref_topic=12798286)



©2026 Google

  * [Privacy Policy](//www.google.com/intl/en/privacy.html)
  * [Terms of Service](https://www.google.com/accounts/TOS)



Language  Afrikaans‎català‎dansk‎Deutsch‎eesti‎English (United Kingdom)‎español‎español (Latinoamérica)‎Filipino‎français‎français (Canada)‎Gaeilge‎hrvatski‎Indonesia‎isiZulu‎italiano‎Kiswahili‎latviešu‎lietuvių‎magyar‎Malti‎Melayu‎Nederlands‎norsk‎polski‎português‎português (Brasil)‎română‎slovenčina‎slovenščina‎suomi‎svenska‎Tiếng Việt‎Türkçe‎čeština‎Ελληνικά‎български‎русский‎српски‎українська‎‏עברית‏اردو‏العربيةहिन्दी‎தமிழ்‎ಕನ್ನಡ‎ไทย‎አማርኛ‎中文（简体）‎中文（繁體）‎中文（香港）‎日本語‎한국어‎ English‎

Enable Dark Mode

Send feedback on...

This help content & information General Help Center experience

Search

Clear search

Close search

Google apps

Main menu

12753178491813942972

true

Search Help Center

false

true

true

true

true

true

92637

false

false

false

false

false

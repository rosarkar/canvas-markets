import { Html, Head, Main, NextScript } from 'next/document'

// Set the saved theme before first paint so there's no flash. Default is dark
// (no attribute); only an explicit "light" choice adds data-theme="light".
const themeInit = `(function(){try{if(localStorage.getItem('canvas-theme')==='light'){document.documentElement.setAttribute('data-theme','light')}}catch(e){}})();`

export default function Document() {
  return (
    <Html lang="en" suppressHydrationWarning>
      <Head />
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}

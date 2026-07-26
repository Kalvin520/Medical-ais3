-- Orthanc Lua: keep permissive; patient-level DICOMweb scope is enforced by pacs-gw
-- (IncomingHttpRequestFilter does not receive query strings).

function IncomingHttpRequestFilter(method, uri, ip, username, httpHeaders)
  return true
end

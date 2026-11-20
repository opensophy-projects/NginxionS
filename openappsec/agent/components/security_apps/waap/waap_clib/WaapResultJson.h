 

#pragma once
#include "Waf2Engine.h"
#include "WaapAssetState.h"
#include <string>

std::string buildWaapResultJson(Waf2ScanResult *m_scanResult, const Waf2Transaction &t, bool bSendResponse,
    const std::string &normalizedUri, const std::string &uri, bool bForceBlock,
    bool bForceException);

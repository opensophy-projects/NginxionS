 

#include <algorithm>
#include <string>
#include <cctype>
#include <boost/regex.hpp>
#include "WaapOverrideFunctor.h"
#include "WaapOverride.h"
#include "Waf2Engine.h"
#include "CidrMatch.h"
#include "RegexComparator.h"
#include "agent_core_utilities.h"
#include "debug.h"

USE_DEBUG_FLAG(D_WAAP_OVERRIDE);

#define REGX_MATCH(FIELD_FETCH) \
    NGEN::Regex::regexMatch(__FILE__, __LINE__, FIELD_FETCH.c_str(), what, *rx)
#define W2T_REGX_MATCH(FIELD_GETTER) \
    REGX_MATCH(waf2Transaction.FIELD_GETTER())

WaapOverrideFunctor::WaapOverrideFunctor(Waf2Transaction& waf2Transaction) :waf2Transaction(waf2Transaction)
{
}

bool WaapOverrideFunctor::matchSameHeader(const Waap::Override::Match &conditions) const
{
    if (!waf2Transaction.checkIsHeaderOverrideScanRequired()) return false;

    auto header_matcher = *this;
    for (const auto &header : waf2Transaction.getHdrPairs()) {
        header_matcher.current_header = &header;
        if (conditions.match(header_matcher)) return true;
    }
    return false;
}

bool WaapOverrideFunctor::operator()(const std::string& tag, const std::vector<Waap::Util::CIDRData> &values) {
    std::string sourceIp;
    if (tag == "sourceip") {
        dbgDebug(D_WAAP_OVERRIDE)
            << "Remote IP Address : "
            << waf2Transaction.getRemoteAddr();

        sourceIp = waf2Transaction.getRemoteAddr();
    } else if (tag == "sourceidentifier") {
        dbgDebug(D_WAAP_OVERRIDE) << "Remote IP Address : " << waf2Transaction.getRemoteAddr();
        sourceIp = waf2Transaction.getSourceIdentifier();
    } else {
        dbgWarning(D_WAAP_OVERRIDE) << "Unsupported tag: " << tag;
        return false;
    }

    Waap::Util::CIDRData source_cidr;
    if (!Waap::Util::isCIDR(sourceIp, source_cidr)) {
        dbgWarning(D_WAAP_OVERRIDE) << "Failed to create subnet from: " << sourceIp;
        return false;
    }


    int left = 0;
    int right = values.size() - 1;

    while (left <= right) {
        int mid = left + (right - left) / 2;
        if (Waap::Util::cidrMatch(sourceIp, values[mid])) return true;

        if (values[mid] < source_cidr) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    return false;
}

bool WaapOverrideFunctor::operator()(
    const std::string &tag,
    const std::set<std::shared_ptr<boost::regex>, Waap::Util::RegexComparator> &rxes)
{
    boost::cmatch what;
    std::string tagLower = tag;
    std::transform(tagLower.begin(), tagLower.end(), tagLower.begin(), ::tolower);

    try {
        if (tagLower == "method") {
            for (const auto &rx : rxes) {
                if (W2T_REGX_MATCH(getMethod)) return true;
            }
            return false;
        }
        else if (tagLower == "url") {
            for (const auto &rx : rxes) {
                if (W2T_REGX_MATCH(getUri)) return true;
            }
            return false;
        }
        else if (tagLower == "hostname") {
            for (const auto &rx : rxes) {
                if (W2T_REGX_MATCH(getHost)) return true;
            }
            return false;
        }
        else if (tagLower == "sourceidentifier") {
            for (const auto &rx : rxes) {
                if (W2T_REGX_MATCH(getSourceIdentifier)) return true;
            }
            return false;
        }
        else if (tagLower == "keyword" || tagLower == "indicator") {
            for (const auto &rx : rxes) {
                for (const std::string& keywordStr : waf2Transaction.getKeywordMatches()) {
                    if (REGX_MATCH(keywordStr)) {
                        return true;
                    }
                }
            }
            return false;
        }
        else if (tagLower == "paramname") {
            for (const auto &rx : rxes) {
                for (const DeepParser::KeywordInfo& keywordInfo : waf2Transaction.getKeywordInfo()) {
                    if (REGX_MATCH(keywordInfo.getName())) {
                        return true;
                    }
                }
                if (W2T_REGX_MATCH(getParamKey)) return true;
                if (W2T_REGX_MATCH(getParam)) return true;
            }
            return false;
        }
        else if (tagLower == "paramvalue") {
            for (const auto &rx : rxes) {
                for (const DeepParser::KeywordInfo& keywordInfo : waf2Transaction.getKeywordInfo()) {
                    if (REGX_MATCH(keywordInfo.getValue())) {
                        return true;
                    }
                }
                if (W2T_REGX_MATCH(getSample)) return true;
            }

            return false;
        }
        else if (tagLower == "paramlocation") {
            for (const auto &rx : rxes) {
                if (W2T_REGX_MATCH(getLocation)) return true;
            }
            return false;
        }
        else if (tagLower == "responsebody") {
            waf2Transaction.getResponseInspectReasons().setApplyOverride(true);
            if (!waf2Transaction.getResponseBody().empty()) {
                for (const auto &rx : rxes) {
                    boost::smatch matcher;
                    if (NGEN::Regex::regexSearch(
                        __FILE__,
                        __LINE__,
                        waf2Transaction.getResponseBody().c_str(),
                        matcher,
                        *rx
                    )) {
                        return true;
                    }
                }
                return false;
            } else {
                return false;
            }
        } else if (tagLower == "headername" || tagLower == "headervalue") {
            if (!waf2Transaction.checkIsHeaderOverrideScanRequired()) {
                dbgDebug(D_WAAP_OVERRIDE) << "Header override scan is not required";
                return false;
            }
            const auto matches_header = [&](const std::pair<std::string, std::string> &header) {
                std::string value = tagLower == "headername" ? header.first : header.second;
                std::transform(value.begin(), value.end(), value.begin(), ::tolower);
                for (const auto &rx : rxes) {
                    if (REGX_MATCH(value)) return true;
                }
                return false;
            };
            if (current_header) return matches_header(*current_header);
            const auto headers = waf2Transaction.getHdrPairs();
            return std::any_of(headers.begin(), headers.end(), matches_header);
        }
    }
    catch (std::runtime_error & e) {
        dbgDebug(D_WAAP_OVERRIDE) << "RegEx match for tag " << tag << " failed due to: " << e.what();
        return false;
    }
    // Unknown tag: should not occur
    dbgDebug(D_WAAP) << "Invalid override tag: " << tag;
    return false;
}

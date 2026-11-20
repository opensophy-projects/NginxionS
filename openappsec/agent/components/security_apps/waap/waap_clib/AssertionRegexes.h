 

#ifndef __ASSERTION_REGEXES_H__
#define __ASSERTION_REGEXES_H__

#include <boost/regex.hpp>

namespace Waap {
namespace AssertionRegexes {

// Static const boost regexes used in processAssertions() function
// These regexes detect various assertion patterns in regex strings
// The patterns are in a separate file to avoid this codestyle checker issue:
// "error T009: comma should be followed by whitespace"
static const boost::regex reStartNonWordBehind(R"(\(\?<!\\w\))");  // (?<!\w)
static const boost::regex reEndNonWordAhead(R"(\(\?!\\w\))");      // (?!\w)
static const boost::regex reEndNonWordSpecial(R"(\(\?=\[\^\\w\?<>:=\]\|\$\))"); // (?=[^\w?<>:=]|$)
static const boost::regex rePathTraversalStart(R"(\(\?<!\[\\\.\,:\]\))"); // (?<![\.,:])
static const boost::regex rePathTraversalEnd(R"(\(\?!\[\\\.\,:\]\))");    // (?![\.,:])

} // namespace AssertionRegexes
} // namespace Waap

#endif // __ASSERTION_REGEXES_H__

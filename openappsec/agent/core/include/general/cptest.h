 

#if !defined(__CP_TEST_H__)
#define __CP_TEST_H__

//
// CP definitions which are useful in many unit tests
//

#include <string>
#include <vector>
#include <ostream>
#include <functional>

#include "cptest/cptest_basic.h"
#include "cptest/cptest_file.h"
#include "cptest/cptest_singleton.h"
#include "cptest/cptest_maybe.h"
#include "buffer.h"
#include "scope_exit.h"
#include "tostring.h"

std::ostream& operator<<(std::ostream &os, const Buffer &buf);

// Parse a hex string, e.g. the output of tcpdump -xx, into a vector.
std::vector<u_char> cptestParseHex(const std::string &hex_text);

// The inverse of cptest_parse_hex
// Take a vector of data, and generate hex from it output, like tcpdump.
std::string cptestGenerateHex(const std::vector<u_char> &vec, bool print_offsets);

#endif // __CP_TEST_H__

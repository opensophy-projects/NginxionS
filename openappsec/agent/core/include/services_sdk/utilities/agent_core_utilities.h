 

#ifndef __AGENT_CORE_UTILITIES_H__
#define __AGENT_CORE_UTILITIES_H__

#include <sys/stat.h>
#include <string>
#include <boost/regex.hpp>

#include "maybe_res.h"

namespace NGEN
{

namespace Filesystem
{

bool exists(const std::string &path);
bool isDirectory(const std::string &path);
Maybe<std::vector<std::string>> getDirectoryFiles(const std::string &path);
bool makeDir(const std::string &path, mode_t permission = S_IRWXU);
bool makeDirRecursive(const std::string &path, mode_t permission = S_IRWXU);
bool deleteDirectory(const std::string &path, bool delete_content = false);
bool touchFile(const std::string &path);
std::string resolveFullPath(const std::string &input_path);

bool
copyFile(
    const std::string &src,
    const std::string &dest,
    bool overide_if_exists,
    mode_t permission = (S_IWUSR | S_IRUSR)
);

bool
createFileWithContent(
    const std::string &dest,
    const std::string &content,
    bool overide_if_exists,
    mode_t permission = (S_IWUSR | S_IRUSR)
);

bool deleteFile(const std::string &path);
std::string convertToHumanReadable(uint64_t size_in_bytes);
std::string getFileName(const std::string &path);
bool copyDirectory(const std::string &src_dir_path, const std::string &dst_dir_path);

}// namespace Filesystem

namespace Regex
{

bool
regexMatch(const char *file, int line, const char *sample, boost::cmatch &match, const boost::regex &regex);

bool
regexMatch(const char *file, int line, const std::string &sample, boost::smatch &match, const boost::regex &regex);

bool
regexMatch(const char *file, int line, const std::string &sample, const boost::regex &regex);

bool
regexMatch(const char *file, int line, std::string &sample, const boost::regex &regex);

bool
regexSearch(const char *file, int line, const std::string &sample, boost::smatch &match, const boost::regex &regex);

std::string
regexReplace(
    const char *file,
    int line,
    const std::string &sample,
    const boost::regex &regex,
    const std::string &replace
);

} // namespace Regex

namespace Strings
{

std::string removeTrailingWhitespaces(std::string str);
std::string removeLeadingWhitespaces(std::string str);
std::string trim(std::string str);
std::string toLower(std::string str);
bool startsWith(const std::string &str, const std::string &prefix);

} // namespace Strings

} // namespace NGEN

#endif // __AGENT_CORE_UTILITIES_H__

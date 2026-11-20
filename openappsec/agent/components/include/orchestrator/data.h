 

#ifndef __DATA_H__
#define __DATA_H__

#include <string>
#include <map>

#include "cereal/archives/json.hpp"
#include "cereal/types/string.hpp"
#include "cereal/types/vector.hpp"

#include "debug.h"
#include "maybe_res.h"

class Data
{
public:
    enum class ChecksumTypes { SHA1, SHA256, SHA512, MD5 };

    const std::string & getDownloadPath() const { return download_path; }
    const std::string & getVersion() const { return version; }
    const std::string & getChecksum() const { return checksum_value; }
    const ChecksumTypes & getChecksumType() const { return checksum_type; }

    void serialize(cereal::JSONInputArchive & in_archive);

private:
    ChecksumTypes checksum_type = ChecksumTypes::SHA256;
    std::string version;
    std::string download_path;
    std::string checksum_value;
};

#endif // __DATA_H__

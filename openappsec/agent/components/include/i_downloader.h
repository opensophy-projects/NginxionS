 

#ifndef __I_DOWNLOADER_H__
#define __I_DOWNLOADER_H__

#include "i_orchestration_tools.h"
#include "i_update_communication.h"

#include <string>
#include <vector>

class CNMCertificate;

class I_Downloader
{
public:
    virtual Maybe<std::string> downloadFile(
        const std::string &checksum,
        Package::ChecksumTypes,
        const GetResourceFile &resourse_file
    ) const = 0;

    virtual Maybe<std::map<std::pair<std::string, std::string>, std::string>>downloadVirtualFileFromFog(
        const GetResourceFile &resourse_file,
        Package::ChecksumTypes checksum_type
    ) const = 0;

    virtual Maybe<std::string> downloadFileFromURL(
        const std::string &url,
        const std::string &checksum,
        Package::ChecksumTypes checksum_type,
        const std::string &service_name
    ) const = 0;

    virtual Maybe<std::string> checkIfFileExists(const Package &package) const = 0;

    virtual void removeDownloadFile(const std::string &file_name) const = 0;

    virtual std::string getProfileFromMap(const std::string &tenant_id) const = 0;

    virtual Maybe<std::string> downloadCertificatesFromFog(
        const std::vector<std::string> &certificate_ids
    ) const = 0;
};

#endif // __I_DOWNLOADER_H__

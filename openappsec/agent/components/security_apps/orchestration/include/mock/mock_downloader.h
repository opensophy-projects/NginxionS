 

#ifndef __MOCK_DOWNLOADER_H__
#define __MOCK_DOWNLOADER_H__

#include "cptest.h"
#include "i_downloader.h"

#include <string>

class MockDownloader :
    public Singleton::Provide<I_Downloader>::From<MockProvider<I_Downloader>>
{
public:
    MOCK_CONST_METHOD3(
        downloadFile,
        Maybe<std::string>(const std::string &, Package::ChecksumTypes, const GetResourceFile &)
    );

    MOCK_CONST_METHOD2(
        downloadVirtualFileFromFog,
        Maybe<std::map<std::pair<std::string, std::string>, std::string>>(
            const GetResourceFile &,
            Package::ChecksumTypes
        )
    );

    MOCK_CONST_METHOD4(
        downloadFileFromURL,
        Maybe<std::string>(const std::string &, const std::string &, Package::ChecksumTypes, const std::string &)
    );

    MOCK_CONST_METHOD1(
        checkIfFileExists,
        Maybe<std::string>(const Package &)
    );

    MOCK_CONST_METHOD1(
        removeDownloadFile,
        void(const std::string &)
    );

    MOCK_CONST_METHOD1(
        getProfileFromMap,
        std::string(const std::string &)
    );

    MOCK_CONST_METHOD1(
        downloadCertificatesFromFog,
        Maybe<std::string>(const std::vector<std::string> &)
    );

};

#endif // __MOCK_DOWNLOADER_H__

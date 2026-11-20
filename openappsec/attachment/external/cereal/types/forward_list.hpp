/*! \file forward_list.hpp
    \brief Support for types found in \<forward_list\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_FORWARD_LIST_HPP_
#define CEREAL_TYPES_FORWARD_LIST_HPP_

#include <cereal/cereal.hpp>
#include <forward_list>

namespace cereal
{
  //! Saving for std::forward_list all other types
  template <class Archive, class T, class A> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::forward_list<T, A> const & forward_list )
  {
    // write the size - note that this is slow because we need to traverse
    // the entire list. there are ways we could avoid this but this was chosen
    // since it works in the most general fashion with any archive type
    size_type const size = std::distance( forward_list.begin(), forward_list.end() );

    ar( make_size_tag( size ) );

    // write the list
    for( const auto & i : forward_list )
      ar( i );
  }

  //! Loading for std::forward_list all other types from
  template <class Archive, class T, class A>
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::forward_list<T, A> & forward_list )
  {
    size_type size;
    ar( make_size_tag( size ) );

    forward_list.resize( static_cast<size_t>( size ) );

    for( auto & i : forward_list )
      ar( i );
  }
} // namespace cereal

#endif // CEREAL_TYPES_FORWARD_LIST_HPP_
